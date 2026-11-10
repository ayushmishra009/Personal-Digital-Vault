package domain

import "time"

type CmsModule struct {
	ID           string    `json:"id"`
	AccountID    string    `json:"accountId"`
	ModuleKey    string    `json:"moduleKey"`
	DisplayName  string    `json:"displayName"`
	Description  *string   `json:"description"`
	IconKey      string    `json:"iconKey"`
	IsEnabled    bool      `json:"isEnabled"`
	DisplayOrder int       `json:"displayOrder"`
	RouteKey     string    `json:"routeKey"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CmsSection struct {
	ID             string         `json:"id"`
	AccountID      string         `json:"accountId"`
	ScreenKey      string         `json:"screenKey"`
	SectionType    string         `json:"sectionType"`
	Title          string         `json:"title"`
	ContentPayload map[string]any `json:"contentPayload"`
	StyleConfig    map[string]any `json:"styleConfig"`
	DisplayOrder   int            `json:"displayOrder"`
	IsEnabled      bool           `json:"isEnabled"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
}

type CmsNavigationItem struct {
	ID           string    `json:"id"`
	AccountID    string    `json:"accountId"`
	Label        string    `json:"label"`
	RouteKey     string    `json:"routeKey"`
	IconKey      string    `json:"iconKey"`
	DisplayOrder int       `json:"displayOrder"`
	IsEnabled    bool      `json:"isEnabled"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CmsThemeSettings struct {
	AccountID    string    `json:"accountId"`
	ThemePreset  string    `json:"themePreset"`
	PrimaryColor string    `json:"primaryColor"`
	BorderRadius string    `json:"borderRadius"`
	Density      string    `json:"density"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CmsRevision struct {
	ID             string         `json:"id"`
	AccountID      string         `json:"accountId"`
	RevisionNumber int            `json:"revisionNumber"`
	ActorDeviceID  *string        `json:"actorDeviceId"`
	ChangeSummary  string         `json:"changeSummary"`
	Snapshot       map[string]any `json:"snapshot,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type AppConfiguration struct {
	Modules        []CmsModule         `json:"modules"`
	Navigation     []CmsNavigationItem `json:"navigation"`
	Sections       []CmsSection        `json:"sections"`
	Theme          CmsThemeSettings    `json:"theme"`
	RevisionNumber int                 `json:"revisionNumber"`
}
