# Go quickstart

MediaRuntime does not yet publish an official Go SDK. This example uses only Go's standard library and the public HTTP API.

```bash
cd go
cp ../.env.example ../.env
# Export MEDIARUNTIME_API_KEY and MEDIARUNTIME_SOURCE in your shell.
go run .
```

Unlike the official Node and Python SDKs, this raw HTTP example requires an HTTP(S) or `gs://` source. It does not upload a local file automatically.

The production API URL is built in. Set `MEDIARUNTIME_BASE_URL` only when testing against a local gateway or staging environment.
