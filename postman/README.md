# Postman quickstart

MediaRuntime publishes its canonical OpenAPI 3.1 contract directly. Importing the URL avoids maintaining a second hand-written API collection.

1. In Postman, choose **Import → Link**.
2. Enter `https://mediaruntime.com/openapi.json`.
3. Choose **Specification with a Postman Collection**.
4. Import [`MediaRuntime.example.postman_environment.json`](MediaRuntime.example.postman_environment.json) or set the collection's `baseUrl` to `https://mediaruntime.com`.
5. Put a server-side API key in the local `ProductionApiKey` variable. Do not share or export a populated environment.

`POST /v1/sandbox/session` requires no authentication or request body. Copy its returned `sandbox_token` into the `SandboxToken` variable when trying bounded sandbox jobs.

The bundle endpoint returns a `307` redirect to the signed ZIP. Postman follows redirects by default and may display the ZIP bytes as text. Use **Send and Download**, **Save Response**, or disable automatic redirects to inspect the `Location` header.

The OpenAPI import is the source of truth. Re-import after a gateway contract update rather than editing generated requests independently.
