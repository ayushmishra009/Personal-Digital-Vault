package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/middleware"
	"github.com/personal-digital-vault/api/internal/router"
)

type config struct {
	addr           string
	databaseURL    string
	appEnv         string
	allowedOrigins []string
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("pgx", cfg.databaseURL)
	if err != nil {
		log.Fatal("open database configuration: ", err)
	}
	defer db.Close()

	repo := database.NewPostgresRepository(db)
	isSecure := cfg.appEnv == "production"

	rl := middleware.NewRateLimiter(middleware.DefaultRateLimiterConfig())
	defer rl.Stop()

	handler := router.BuildRouter(router.Config{
		Repo:           repo,
		DB:             db,
		IsSecure:       isSecure,
		AllowedOrigins: cfg.allowedOrigins,
		RateLimiter:    rl,
	})

	server := &http.Server{
		Addr:              cfg.addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("API listening on %s (env: %s)", cfg.addr, cfg.appEnv)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() (config, error) {
	cfg := config{
		addr:        valueOr("API_ADDR", "127.0.0.1:8080"),
		databaseURL: os.Getenv("DATABASE_URL"),
		appEnv:      valueOr("APP_ENV", "development"),
	}
	if cfg.databaseURL == "" {
		return config{}, errors.New("DATABASE_URL is required")
	}

	webOrigin := valueOr("WEB_ORIGIN", "http://localhost:5173")
	adminOrigin := valueOr("ADMIN_ORIGIN", "http://localhost:5174")
	cfg.allowedOrigins = []string{webOrigin, adminOrigin}

	return cfg, nil
}

func valueOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
