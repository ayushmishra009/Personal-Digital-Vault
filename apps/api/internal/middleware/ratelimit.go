package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/personal-digital-vault/api/internal/handlers"
)

type clientBucket struct {
	tokens     float64
	lastRefill time.Time
}

// RateLimiterConfig controls rate limiting behavior.
type RateLimiterConfig struct {
	AuthRequestsPerMinute       int
	EnrollmentRequestsPerMinute int
	DefaultRequestsPerMinute    int
	Enabled                     bool
}

// DefaultRateLimiterConfig provides standard production defaults.
func DefaultRateLimiterConfig() RateLimiterConfig {
	return RateLimiterConfig{
		AuthRequestsPerMinute:       15,
		EnrollmentRequestsPerMinute: 30,
		DefaultRequestsPerMinute:    200,
		Enabled:                     true,
	}
}

// RateLimiter enforces per-IP request rate limiting with token buckets.
type RateLimiter struct {
	mu      sync.Mutex
	cfg     RateLimiterConfig
	buckets map[string]*clientBucket
	stopCh  chan struct{}
}

// NewRateLimiter initializes a thread-safe rate limiter.
func NewRateLimiter(cfg RateLimiterConfig) *RateLimiter {
	rl := &RateLimiter{
		cfg:     cfg,
		buckets: make(map[string]*clientBucket),
		stopCh:  make(chan struct{}),
	}

	// Periodically prune stale client entries older than 5 minutes
	go rl.cleanupRoutine(5 * time.Minute)

	return rl
}

func (rl *RateLimiter) cleanupRoutine(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for ip, bucket := range rl.buckets {
				if bucket.lastRefill.Before(cutoff) {
					delete(rl.buckets, ip)
				}
			}
			rl.mu.Unlock()
		case <-rl.stopCh:
			return
		}
	}
}

// Stop cleanly terminates background cleanup routines.
func (rl *RateLimiter) Stop() {
	close(rl.stopCh)
}

func extractClientIP(r *http.Request) string {
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if net.ParseIP(ip) != nil {
				return ip
			}
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}

	return r.RemoteAddr
}

// Middleware returns an HTTP middleware wrapping request handling with rate limits.
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !rl.cfg.Enabled {
				next.ServeHTTP(w, r)
				return
			}

			path := r.URL.Path
			var capacity float64

			if strings.HasPrefix(path, "/api/v1/auth/login") || strings.HasPrefix(path, "/api/v1/auth/register") {
				capacity = float64(rl.cfg.AuthRequestsPerMinute)
			} else if strings.HasPrefix(path, "/api/v1/device-enrollments") {
				capacity = float64(rl.cfg.EnrollmentRequestsPerMinute)
			} else if strings.HasPrefix(path, "/api/v1/") {
				capacity = float64(rl.cfg.DefaultRequestsPerMinute)
			} else {
				// Health and root endpoints are not rate-limited
				next.ServeHTTP(w, r)
				return
			}

			ip := extractClientIP(r)
			bucketKey := ip + ":" + pathCategory(path)

			rl.mu.Lock()
			now := time.Now()
			bucket, exists := rl.buckets[bucketKey]
			if !exists {
				bucket = &clientBucket{
					tokens:     capacity - 1.0,
					lastRefill: now,
				}
				rl.buckets[bucketKey] = bucket
				rl.mu.Unlock()
				next.ServeHTTP(w, r)
				return
			}

			// Refill tokens based on elapsed time (capacity / 60 seconds)
			elapsed := now.Sub(bucket.lastRefill).Seconds()
			refillRate := capacity / 60.0
			bucket.tokens += elapsed * refillRate
			if bucket.tokens > capacity {
				bucket.tokens = capacity
			}
			bucket.lastRefill = now

			if bucket.tokens < 1.0 {
				rl.mu.Unlock()
				w.Header().Set("Retry-After", "60")
				handlers.WriteProblem(w, http.StatusTooManyRequests, "Too Many Requests", "Rate limit exceeded. Please retry after some time.")
				return
			}

			bucket.tokens -= 1.0
			rl.mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}

func pathCategory(path string) string {
	if strings.HasPrefix(path, "/api/v1/auth/login") || strings.HasPrefix(path, "/api/v1/auth/register") {
		return "auth"
	}
	if strings.HasPrefix(path, "/api/v1/device-enrollments") {
		return "enrollment"
	}
	return "general"
}
