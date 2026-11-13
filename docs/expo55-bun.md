# Expo55/Bun source profile

`expo-bun-source-inventory/1` supports the static Expo Router55.0.x slice used by
Bouldernana. It requires `expo-router/entry`, installed Expo55.0.x and
Router55.0.x, and a Bun text lockfile with lockfileVersion1/configVersion1.
Installed versions, package declarations and root-workspace lock declarations
must agree. Declarations are exact, tilde or caret55.0 patch ranges; installed
versions stay within55.0.x. Mixed lockfiles and binary Bun locks are refused.

Static app configuration, aliases, guarded/hidden registrations, dynamic and
history uncertainty reuse the existing Expo source parser and independent
pipeline conformance. A custom extractor still requires exact-hash review and
validation. No model, generated npm lockfile, package version rewrite or config
execution is needed. Refresh makes zero author calls.

The profile does not establish runtime reachability or app/build identity.
The local native QA also found two runner protocol issues: semantically equal
native dictionaries can serialize object keys in different orders, and scroll
containers report clipped-content markers. Fingerprints now use canonical object
serialization, while explicit hidden/offscreen nodes remain excluded; clipped
content metadata does not hide a whole container. Fresh-target and modal checks
remain in force.
