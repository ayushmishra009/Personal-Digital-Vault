package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type CmsHandler struct {
	Repo database.Repository
}

type UpdateCmsModuleRequest struct {
	DisplayName  string  `json:"displayName"`
	Description  *string `json:"description"`
	IsEnabled    bool    `json:"isEnabled"`
	DisplayOrder int     `json:"displayOrder"`
}

type CreateCmsSectionRequest struct {
	ScreenKey      string         `json:"screenKey"`
	SectionType    string         `json:"sectionType"`
	Title          string         `json:"title"`
	ContentPayload map[string]any `json:"contentPayload"`
	StyleConfig    map[string]any `json:"styleConfig"`
	DisplayOrder   int            `json:"displayOrder"`
	IsEnabled      bool           `json:"isEnabled"`
}

type UpdateCmsSectionRequest struct {
	Title          string         `json:"title"`
	ContentPayload map[string]any `json:"contentPayload"`
	StyleConfig    map[string]any `json:"styleConfig"`
	DisplayOrder   int            `json:"displayOrder"`
	IsEnabled      bool           `json:"isEnabled"`
}

type UpdateCmsNavigationItemRequest struct {
	Label        string `json:"label"`
	DisplayOrder int    `json:"displayOrder"`
	IsEnabled    bool   `json:"isEnabled"`
}

type UpdateCmsThemeRequest struct {
	ThemePreset  string `json:"themePreset"`
	PrimaryColor string `json:"primaryColor"`
	BorderRadius string `json:"borderRadius"`
	Density      string `json:"density"`
}

func (h *CmsHandler) GetAppConfiguration(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	config, err := h.Repo.GetAppConfiguration(r.Context(), account.ID)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, config)
}

func (h *CmsHandler) ListModules(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	modules, err := h.Repo.ListCmsModules(r.Context(), account.ID)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}
	if modules == nil {
		modules = []domain.CmsModule{}
	}

	WriteJSON(w, http.StatusOK, modules)
}

func (h *CmsHandler) UpdateModule(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	moduleKey := r.PathValue("moduleKey")
	if moduleKey == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "moduleKey is required")
		return
	}

	var req UpdateCmsModuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON request body")
		return
	}

	if strings.TrimSpace(req.DisplayName) == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "displayName cannot be empty")
		return
	}

	updated, err := h.Repo.UpdateCmsModule(
		r.Context(),
		account.ID,
		moduleKey,
		strings.TrimSpace(req.DisplayName),
		req.Description,
		req.IsEnabled,
		req.DisplayOrder,
	)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Module not found")
			return
		}
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, updated)
}

func (h *CmsHandler) ListSections(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	var screenKeyPtr *string
	sk := r.URL.Query().Get("screenKey")
	if sk != "" {
		screenKeyPtr = &sk
	}

	sections, err := h.Repo.ListCmsSections(r.Context(), account.ID, screenKeyPtr)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}
	if sections == nil {
		sections = []domain.CmsSection{}
	}

	WriteJSON(w, http.StatusOK, sections)
}

func (h *CmsHandler) CreateSection(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	var req CreateCmsSectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON request body")
		return
	}

	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.ScreenKey) == "" || strings.TrimSpace(req.SectionType) == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "title, screenKey, and sectionType are required")
		return
	}

	sec := &domain.CmsSection{
		AccountID:      account.ID,
		ScreenKey:      strings.TrimSpace(req.ScreenKey),
		SectionType:    strings.TrimSpace(req.SectionType),
		Title:          strings.TrimSpace(req.Title),
		ContentPayload: req.ContentPayload,
		StyleConfig:    req.StyleConfig,
		DisplayOrder:   req.DisplayOrder,
		IsEnabled:      req.IsEnabled,
	}

	created, err := h.Repo.CreateCmsSection(r.Context(), sec)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusCreated, created)
}

func (h *CmsHandler) UpdateSection(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	sectionID := r.PathValue("sectionId")
	if sectionID == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "sectionId is required")
		return
	}

	var req UpdateCmsSectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON request body")
		return
	}

	if strings.TrimSpace(req.Title) == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "title cannot be empty")
		return
	}

	updated, err := h.Repo.UpdateCmsSection(
		r.Context(),
		account.ID,
		sectionID,
		strings.TrimSpace(req.Title),
		req.ContentPayload,
		req.StyleConfig,
		req.DisplayOrder,
		req.IsEnabled,
	)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Section not found")
			return
		}
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, updated)
}

func (h *CmsHandler) DeleteSection(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	sectionID := r.PathValue("sectionId")
	if sectionID == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "sectionId is required")
		return
	}

	if err := h.Repo.DeleteCmsSection(r.Context(), account.ID, sectionID); err != nil {
		if errors.Is(err, database.ErrNotFound) {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Section not found")
			return
		}
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *CmsHandler) ListNavigation(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	nav, err := h.Repo.ListCmsNavigation(r.Context(), account.ID)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}
	if nav == nil {
		nav = []domain.CmsNavigationItem{}
	}

	WriteJSON(w, http.StatusOK, nav)
}

func (h *CmsHandler) UpdateNavigationItem(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	itemID := r.PathValue("itemId")
	if itemID == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "itemId is required")
		return
	}

	var req UpdateCmsNavigationItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON request body")
		return
	}

	if strings.TrimSpace(req.Label) == "" {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "label cannot be empty")
		return
	}

	updated, err := h.Repo.UpdateCmsNavigationItem(
		r.Context(),
		account.ID,
		itemID,
		strings.TrimSpace(req.Label),
		req.DisplayOrder,
		req.IsEnabled,
	)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Navigation item not found")
			return
		}
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, updated)
}

func (h *CmsHandler) GetTheme(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	theme, err := h.Repo.GetCmsTheme(r.Context(), account.ID)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, theme)
}

func (h *CmsHandler) UpdateTheme(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	var req UpdateCmsThemeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON request body")
		return
	}

	theme := &domain.CmsThemeSettings{
		AccountID:    account.ID,
		ThemePreset:  strings.TrimSpace(req.ThemePreset),
		PrimaryColor: strings.TrimSpace(req.PrimaryColor),
		BorderRadius: strings.TrimSpace(req.BorderRadius),
		Density:      strings.TrimSpace(req.Density),
	}

	updated, err := h.Repo.UpdateCmsTheme(r.Context(), account.ID, theme)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, updated)
}

func (h *CmsHandler) ListRevisions(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	revisions, err := h.Repo.ListCmsRevisions(r.Context(), account.ID)
	if err != nil {
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}
	if revisions == nil {
		revisions = []domain.CmsRevision{}
	}

	WriteJSON(w, http.StatusOK, revisions)
}

func (h *CmsHandler) RestoreRevision(w http.ResponseWriter, r *http.Request) {
	account, ok := domain.AccountFromContext(r.Context())
	if !ok || account == nil {
		WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
		return
	}

	revNumStr := r.PathValue("revisionNumber")
	revNum, err := strconv.Atoi(revNumStr)
	if err != nil || revNum <= 0 {
		WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid positive revisionNumber required")
		return
	}

	var actorDeviceID string
	if device, ok := domain.DeviceFromContext(r.Context()); ok && device != nil {
		actorDeviceID = device.ID
	}

	config, err := h.Repo.RestoreCmsRevision(r.Context(), account.ID, revNum, actorDeviceID)
	if err != nil {
		if errors.Is(err, database.ErrNotFound) {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Revision not found")
			return
		}
		WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, config)
}
