package main

import (
	"github.com/mythologyli/zju-connect/client/atrust/auth"
	"github.com/mythologyli/zju-connect/client/authchallenge"
	"net/url"
	"testing"
)

func TestAuthDiscoveryDoesNotGuessRealmOrDowngrade(t *testing.T) {
	methods := []auth.AuthInfo{{AuthType: "auth/httpsOauth2", LoginDomain: "campus", AuthName: "University"}, {AuthType: "auth/psw", LoginDomain: "local", AuthName: "Local"}, {AuthType: "auth/proprietary", LoginDomain: "device"}}
	f, err := aTrustAuthField(methods)
	if err != nil || len(f.Choices) != 2 {
		t.Fatalf("discovery: %v %#v", err, f)
	}
	m, err := selectATrustMethod(methods, f.Choices[0].Value)
	if err != nil || m.AuthType != "auth/httpsOauth2" || m.LoginDomain != "campus" {
		t.Fatalf("wrong selection: %v", err)
	}
	if _, err := selectATrustMethod(methods, `["auth/psw","unknown"]`); err == nil {
		t.Fatal("guessed domain accepted")
	}
	if _, err := aTrustAuthField(methods[2:]); err == nil {
		t.Fatal("unsupported authentication advertised")
	}
	if _, err := aTrustAuthField([]auth.AuthInfo{{AuthType: "auth/psw", LoginDomain: ""}}); err == nil {
		t.Fatal("empty realm accepted")
	}
	m, err = selectATrustMethod(methods[:1], "")
	if err != nil || m.AuthType != "auth/httpsOauth2" {
		t.Fatal("sole method must be selected automatically")
	}
}

func TestExternalCallbacksCannotLeakSessionToAnotherOrigin(t *testing.T) {
	gateway, _ := url.Parse("https://vpn.example.com/")
	for _, v := range []string{"https://other.example.com/passport/v1/auth/httpsOauth2?code=fictional", "http://vpn.example.com/passport/v1/auth/httpsOauth2?code=fictional", "https://vpn.example.com:444/passport/v1/auth/httpsOauth2?code=fictional", "https://user@vpn.example.com/passport/v1/auth/httpsOauth2?code=fictional", "https://vpn.example.com/wrong?code=fictional", "https://vpn.example.com/passport/v1/auth/httpsOauth2", "https://vpn.example.com/passport/v1/auth/httpsOauth2?code=a&code=b"} {
		if validateExternalCallback(gateway, authchallenge.ExternalLoginOAuth2, v) == nil {
			t.Fatalf("unsafe callback accepted: %s", v)
		}
	}
	if err := validateExternalCallback(gateway, authchallenge.ExternalLoginOAuth2, "https://vpn.example.com:443/passport/v1/auth/httpsOauth2?code=fictional"); err != nil {
		t.Fatal(err)
	}
	if err := validateExternalCallback(gateway, authchallenge.ExternalLoginCAS, "https://vpn.example.com/passport/v1/auth/cas?ticket=fictional"); err != nil {
		t.Fatal(err)
	}
}
