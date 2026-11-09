package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func main() {
	if len(os.Args) != 2 || (os.Args[1] != "up" && os.Args[1] != "down") {
		log.Fatal("usage: migrate up|down")
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal("open database configuration: ", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatal("database is not reachable")
	}
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal("configure migration dialect: ", err)
	}

	migrationsDir, err := filepath.Abs(filepath.Join("..", "..", "database", "migrations"))
	if err != nil {
		log.Fatal("resolve migrations directory: ", err)
	}
	if err := goose.RunContext(ctx, os.Args[1], db, migrationsDir); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			log.Fatal("database migration timed out")
		}
		log.Fatal(fmt.Errorf("run %s migration: %w", os.Args[1], err))
	}
}
