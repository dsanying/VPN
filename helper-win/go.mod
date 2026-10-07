module shadowvpn-helper-win

go 1.27.1

require (
	github.com/Microsoft/go-winio v0.6.2
	golang.org/x/sys v0.48.0
	shadowvpn/helperrpc v0.0.0
)

require (
	github.com/creachadair/jrpc2 v1.3.5 // indirect
	github.com/creachadair/mds v0.31.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
)

replace shadowvpn/helperrpc => ../helper-rpc
