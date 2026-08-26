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

func requiredEnv(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		panic("set " + name + " before running this quickstart")
	}
	return value
}

func randomID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

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

func requireSuccess(response *http.Response) error {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	return fmt.Errorf("MediaRuntime returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
}

func main() {
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
