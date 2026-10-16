package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/mythologyli/zju-connect/client/atrust/auth"
	"github.com/mythologyli/zju-connect/client/authchallenge"
)

type authChoice struct {
	Value string `json:"value"`
	Label string `json:"label"`
}
type authField struct {
	Name    string       `json:"name"`
	Label   string       `json:"label"`
	Secret  bool         `json:"secret"`
	Choices []authChoice `json:"choices"`
}

// The upstream callback carries cookies/CSRF data. Never send those to another origin.
func validateExternalCallback(gateway *url.URL, kind authchallenge.ExternalLoginKind, value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || !strings.EqualFold(u.Hostname(), gateway.Hostname()) {
		return fmt.Errorf("invalid authentication callback origin")
	}
	port := func(v *url.URL) string {
		if v.Port() == "" {
			return "443"
		}
		return v.Port()
	}
	if port(u) != port(gateway) {
		return fmt.Errorf("invalid authentication callback port")
	}
	path, token := "/passport/v1/auth/cas", "ticket"
	if kind == authchallenge.ExternalLoginOAuth2 {
		path, token = "/passport/v1/auth/httpsOauth2", "code"
	} else if kind != authchallenge.ExternalLoginCAS {
		return fmt.Errorf("unsupported external authentication")
	}
	if u.Path != path || len(u.Query()[token]) != 1 || u.Query().Get(token) == "" {
		return fmt.Errorf("invalid authentication callback")
	}
	return nil
}

// Only methods wired to our structured challenges are offered. No guessed realm or password fallback.
func aTrustAuthField(methods []auth.AuthInfo) (authField, error) {
	field := authField{Name: "authentication", Label: "认证方式"}
	if len(methods) > 64 {
		return field, fmt.Errorf("too many authentication methods")
	}
	seen := map[string]bool{}
	for _, method := range methods {
		if method.AuthType != "auth/psw" && method.AuthType != "auth/cas" && method.AuthType != "auth/httpsOauth2" && method.AuthType != "auth/smsCheckCode" {
			continue
		}
		if method.LoginDomain == "" || len(method.LoginDomain) > 128 || strings.ContainsAny(method.LoginDomain, "\r\n\x00") {
			return field, fmt.Errorf("invalid authentication domain")
		}
		value, _ := json.Marshal([2]string{method.AuthType, method.LoginDomain})
		if len(value) > 256 {
			return field, fmt.Errorf("authentication option too long")
		}
		label := method.AuthName
		if label == "" {
			label = method.AuthType
		}
		label += " · " + method.LoginDomain
		if len(label) > 256 {
			return field, fmt.Errorf("authentication label too long")
		}
		if !seen[string(value)] {
			field.Choices = append(field.Choices, authChoice{string(value), label})
			seen[string(value)] = true
		}
	}
	if len(field.Choices) == 0 {
		return field, fmt.Errorf("unsupported authentication methods")
	}
	return field, nil
}

func selectATrustMethod(methods []auth.AuthInfo, saved string) (auth.AuthInfo, error) {
	field, err := aTrustAuthField(methods)
	if err != nil {
		return auth.AuthInfo{}, err
	}
	if saved == "" {
		if len(field.Choices) == 1 {
			saved = field.Choices[0].Value
		} else {
			emit(map[string]any{"type": "challenge", "kind": "form", "fields": []authField{field}})
			var response struct {
				Fields map[string]string `json:"fields"`
			}
			if err := reply(&response); err != nil {
				return auth.AuthInfo{}, err
			}
			saved = response.Fields[field.Name]
		}
	}
	for _, choice := range field.Choices {
		if choice.Value != saved {
			continue
		}
		var identity [2]string
		if err := json.Unmarshal([]byte(saved), &identity); err != nil {
			return auth.AuthInfo{}, err
		}
		for _, method := range methods {
			if method.AuthType == identity[0] && method.LoginDomain == identity[1] {
				return method, nil
			}
		}
	}
	return auth.AuthInfo{}, fmt.Errorf("authentication selection changed")
}
