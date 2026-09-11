# Capability: native-endpoint-config

## ADDED Requirements

### Requirement: Configured endpoint routes for native sessions

The daemon host SHALL support named endpoint routes (endpoint URL + scope)
configured in app settings. A native session whose chat selects a configured
route SHALL send provider traffic to that endpoint.

#### Scenario: Proxy user goes native

- WHEN a user configures a proxy route and selects it for a native sub-chat
- THEN the turn runs against the proxy endpoint with no refusal error.

### Requirement: Honest refusal for uncovered endpoints

A native session requesting an endpoint with no configured route SHALL fail
with a clear error naming the missing route. The app SHALL never silently run
the turn against a different endpoint than the one selected.

#### Scenario: Unknown endpoint stays loud

- WHEN a native chat selects an endpoint with no configured route
- THEN the user sees an error naming the endpoint and how to configure it, and
  no request leaves the machine.

### Requirement: Ref-only credentials on configured routes

Endpoint routes SHALL carry URLs only. Credentials for routed traffic SHALL
keep flowing through the existing ref-only path (`set_api_key`); route
configuration and test-connection flows SHALL NOT persist or log credential
material.

#### Scenario: Audit a routed session

- WHEN an auditor inspects route config, main-process logs, and the persisted
  transcript for a routed native session
- THEN endpoint URLs appear but no credential material does.
