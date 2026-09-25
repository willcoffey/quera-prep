## Sandbox networking
Bash egress only via proxy; NO_PROXY covers localhost/10.0.0.0/8, so direct
curl fails. Use `curl --noproxy ''`. VM containers: localhost:<port>.

