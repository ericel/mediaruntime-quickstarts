package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type createJobResponse struct {
	JobID  string `json:"job_id"`
	Status string `json:"status"`
}

type jobStatusResponse struct {
	JobID  string `json:"job_id"`
	Status string `json:"status"`
	Error  string `json:"error"`
	Bundle struct {
		Available   bool   `json:"available"`
		DownloadURL string `json:"download_url"`
	} `json:"bundle"`
}

// requiredEnv fails early instead of allowing a request with missing credentials.
func requiredEnv(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		panic("set " + name + " before running this quickstart")
	}
	return value
}

// randomID gives each quickstart invocation its own logical operation ID.
func randomID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

// apiRequest applies the server-side API key consistently to authenticated calls.
func apiRequest(ctx context.Context, client *http.Client, apiKey, method, url string, body io.Reader) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-API-Key", apiKey)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return client.Do(request)
}

// requireSuccess preserves a bounded portion of the API error for diagnostics.
func requireSuccess(response *http.Response) error {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	return fmt.Errorf("MediaRuntime returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
}

func main() {
	// Keep the API key in a server-side secret store; never ship it to a browser.
	apiKey := requiredEnv("MEDIARUNTIME_API_KEY")
	source := requiredEnv("MEDIARUNTIME_SOURCE")
	baseURL := strings.TrimRight(os.Getenv("MEDIARUNTIME_BASE_URL"), "/")
	if baseURL == "" {
		baseURL = "https://mediaruntime.com"
	}
	downloadPath := os.Getenv("MEDIARUNTIME_DOWNLOAD_PATH")
	if downloadPath == "" {
		downloadPath = "outputs.zip"
	}
	outputAlias := strings.TrimSpace(os.Getenv("MEDIARUNTIME_OUTPUT_ALIAS"))
	if outputAlias == "" {
		outputAlias = "video.web"
	}

	// A source may be public or a time-limited signed read URL. The alias expands
	// to a maintained output recipe before MediaRuntime executes the job.
	requestBody, err := json.Marshal(map[string]any{
		"source":   source,
		"outputs":  []string{outputAlias},
		"metadata": map[string]string{"quickstart": "go"},
	})
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Minute}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/jobs", bytes.NewReader(requestBody))
	if err != nil {
		panic(err)
	}
	request.Header.Set("X-API-Key", apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	// A random key makes every quickstart run new. Production systems should use
	// a stable key derived from their own asset or operation identifier.
	request.Header.Set("Idempotency-Key", "quickstart:go:"+randomID())
	response, err := client.Do(request)
	if err != nil {
		panic(err)
	}
	if err := requireSuccess(response); err != nil {
		response.Body.Close()
		panic(err)
	}
	var created createJobResponse
	err = json.NewDecoder(response.Body).Decode(&created)
	response.Body.Close()
	if err != nil {
		panic(err)
	}
	fmt.Printf("Created %s\n", created.JobID)

	// Polling keeps the standalone example simple. In production, persist the job
	// ID and normally consume signed terminal webhooks instead.
	var terminal jobStatusResponse
	for {
		response, err = apiRequest(ctx, client, apiKey, http.MethodGet, baseURL+"/v1/jobs/"+created.JobID, nil)
		if err != nil {
			panic(err)
		}
		if err := requireSuccess(response); err != nil {
			response.Body.Close()
			panic(err)
		}
		err = json.NewDecoder(response.Body).Decode(&terminal)
		response.Body.Close()
		if err != nil {
			panic(err)
		}
		fmt.Printf("Status: %s\n", terminal.Status)
		if terminal.Status == "COMPLETED" || terminal.Status == "FAILED" || terminal.Status == "REJECTED" || terminal.Status == "PARTIAL" {
			break
		}
		select {
		case <-ctx.Done():
			panic(ctx.Err())
		case <-time.After(2 * time.Second):
		}
	}

	if terminal.Status != "COMPLETED" || terminal.Bundle.DownloadURL == "" {
		panic(fmt.Sprintf("job ended with %s: %s", terminal.Status, terminal.Error))
	}

	// The terminal URL is signed and time-limited. It downloads one ZIP containing
	// every requested rendition, report, subtitle, and metadata file.
	downloadRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, terminal.Bundle.DownloadURL, nil)
	if err != nil {
		panic(err)
	}
	downloadResponse, err := client.Do(downloadRequest)
	if err != nil {
		panic(err)
	}
	defer downloadResponse.Body.Close()
	if err := requireSuccess(downloadResponse); err != nil {
		panic(err)
	}
	// Create an optional parent directory before streaming the bundle to disk.
	if err := os.MkdirAll(filepath.Dir(filepath.Clean(downloadPath)), 0o755); err != nil && filepath.Dir(filepath.Clean(downloadPath)) != "." {
		panic(err)
	}
	file, err := os.Create(downloadPath)
	if err != nil {
		panic(err)
	}
	if _, err := io.Copy(file, downloadResponse.Body); err != nil {
		file.Close()
		panic(err)
	}
	if err := file.Close(); err != nil {
		panic(err)
	}
	fmt.Printf("Downloaded %s bundle to %s\n", created.JobID, downloadPath)
}
