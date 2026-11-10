import React, { useEffect, useState } from "react";
import type {
  AccountSession,
  CmsModule,
  CmsNavigationItem,
  CmsRevision,
  CmsSection,
  CmsThemeSettings,
} from "./api";
import {
  createCmsSection,
  deleteCmsSection,
  getCmsTheme,
  getSession,
  listCmsModules,
  listCmsNavigation,
  listCmsRevisions,
  listCmsSections,
  loginAccount,
  logoutAccount,
  registerAccount,
  restoreCmsRevision,
  updateCmsModule,
  updateCmsNavigationItem,
  updateCmsSection,
  updateCmsTheme,
} from "./api";

type Tab = "sections" | "modules" | "navigation" | "theme" | "revisions";

const ALLOWED_SECTION_TYPES = [
  "welcome",
  "summary",
  "quick_actions",
  "recent_items",
  "vault_cards",
  "custom_info",
  "help_panel",
] as const;

export function App() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("sections");
  const [alert, setAlert] = useState<{
    type: "success" | "danger" | "info";
    message: string;
  } | null>(null);

  // Auth form state
  const [authEmail, setAuthEmail] = useState("admin@example.com");

  // CMS state
  const [sections, setSections] = useState<CmsSection[]>([]);
  const [modules, setModules] = useState<CmsModule[]>([]);
  const [navigation, setNavigation] = useState<CmsNavigationItem[]>([]);
  const [theme, setTheme] = useState<CmsThemeSettings>({
    themePreset: "default",
    primaryColor: "#1c5230",
    borderRadius: "8px",
    density: "comfortable",
  });
  const [revisions, setRevisions] = useState<CmsRevision[]>([]);

  // Section modal state
  const [screenFilter, setScreenFilter] = useState<string>("all");
  const [editingSection, setEditingSection] = useState<CmsSection | null>(null);
  const [isCreatingSection, setIsCreatingSection] = useState(false);
  const [sectionForm, setSectionForm] = useState({
    screenKey: "vault_overview",
    sectionType: "quick_actions",
    title: "",
    contentPayloadStr: "{}",
    styleConfigStr: "{}",
    displayOrder: 1,
    isEnabled: true,
  });

  // Module edit state
  const [editingModule, setEditingModule] = useState<CmsModule | null>(null);
  const [moduleForm, setModuleForm] = useState({
    displayName: "",
    description: "",
    displayOrder: 1,
    isEnabled: true,
  });

  // Nav edit state
  const [editingNav, setEditingNav] = useState<CmsNavigationItem | null>(null);
  const [navForm, setNavForm] = useState({
    label: "",
    displayOrder: 1,
    isEnabled: true,
  });

  const checkSession = async () => {
    try {
      setLoading(true);
      const s = await getSession();
      setSession(s);
      if (s) {
        await loadAllCmsData();
      }
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const showAlert = (type: "success" | "danger" | "info", message: string) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 4000);
  };

  const loadAllCmsData = async () => {
    try {
      const [sec, mod, nav, th, rev] = await Promise.all([
        listCmsSections(),
        listCmsModules(),
        listCmsNavigation(),
        getCmsTheme(),
        listCmsRevisions(),
      ]);
      setSections(sec);
      setModules(mod);
      setNavigation(nav);
      setTheme(th);
      setRevisions(rev);
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to load CMS data",
      );
    }
  };

  // Auth actions
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const fakePub = btoa("admin-device-key-32bytes-long!").replace(/=/g, "");
      const s = await registerAccount({
        email: authEmail,
        deviceLabel: "Admin Browser Console",
        platform: "Web",
        browser: "Chrome",
        publicKeyAlgorithm: "Ed25519",
        publicKey: fakePub,
        credentialType: "external",
        credentialId: `cred-${Date.now()}`,
      });
      setSession(s);
      showAlert("success", `Registered as ${s.account.email}`);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Registration failed",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const s = await loginAccount({
        email: authEmail,
        deviceId: "dev-0001",
        credentialType: "external",
        credentialId: "cred-admin",
      });
      setSession(s);
      showAlert("success", `Logged in as ${s.account.email}`);
      await loadAllCmsData();
    } catch {
      // Fallback: try register if login doesn't match
      await handleRegister(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutAccount();
    setSession(null);
    showAlert("info", "Logged out");
  };

  // Section actions
  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    let contentPayload: Record<string, unknown> = {};
    let styleConfig: Record<string, unknown> = {};
    try {
      contentPayload = JSON.parse(sectionForm.contentPayloadStr);
      styleConfig = JSON.parse(sectionForm.styleConfigStr);
    } catch {
      showAlert(
        "danger",
        "Invalid JSON syntax in Content Payload or Style Config",
      );
      return;
    }

    try {
      if (editingSection) {
        await updateCmsSection(editingSection.id, {
          title: sectionForm.title,
          contentPayload,
          styleConfig,
          displayOrder: sectionForm.displayOrder,
          isEnabled: sectionForm.isEnabled,
        });
        showAlert("success", `Section "${sectionForm.title}" updated`);
      } else {
        await createCmsSection({
          screenKey: sectionForm.screenKey,
          sectionType: sectionForm.sectionType,
          title: sectionForm.title,
          contentPayload,
          styleConfig,
          displayOrder: sectionForm.displayOrder,
          isEnabled: sectionForm.isEnabled,
        });
        showAlert("success", `Section "${sectionForm.title}" created`);
      }
      setIsCreatingSection(false);
      setEditingSection(null);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to save section",
      );
    }
  };

  const handleDeleteSection = async (section: CmsSection) => {
    if (!window.confirm(`Delete section "${section.title}"?`)) return;
    try {
      await deleteCmsSection(section.id);
      showAlert("success", `Section "${section.title}" deleted`);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to delete section",
      );
    }
  };

  const handleToggleSection = async (section: CmsSection) => {
    try {
      await updateCmsSection(section.id, {
        title: section.title,
        contentPayload: section.contentPayload,
        styleConfig: section.styleConfig,
        displayOrder: section.displayOrder,
        isEnabled: !section.isEnabled,
      });
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to toggle section",
      );
    }
  };

  // Module actions
  const handleSaveModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModule) return;
    try {
      await updateCmsModule(editingModule.moduleKey, {
        displayName: moduleForm.displayName,
        description: moduleForm.description || null,
        displayOrder: moduleForm.displayOrder,
        isEnabled: moduleForm.isEnabled,
      });
      showAlert("success", `Module "${moduleForm.displayName}" updated`);
      setEditingModule(null);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to update module",
      );
    }
  };

  const handleToggleModule = async (mod: CmsModule) => {
    try {
      await updateCmsModule(mod.moduleKey, {
        displayName: mod.displayName,
        description: mod.description,
        displayOrder: mod.displayOrder,
        isEnabled: !mod.isEnabled,
      });
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to toggle module",
      );
    }
  };

  // Nav actions
  const handleSaveNav = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNav) return;
    try {
      await updateCmsNavigationItem(editingNav.id, {
        label: navForm.label,
        displayOrder: navForm.displayOrder,
        isEnabled: navForm.isEnabled,
      });
      showAlert("success", `Navigation item "${navForm.label}" updated`);
      setEditingNav(null);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to update navigation item",
      );
    }
  };

  const handleToggleNav = async (item: CmsNavigationItem) => {
    try {
      await updateCmsNavigationItem(item.id, {
        label: item.label,
        displayOrder: item.displayOrder,
        isEnabled: !item.isEnabled,
      });
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to toggle navigation item",
      );
    }
  };

  // Theme actions
  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await updateCmsTheme(theme);
      setTheme(updated);
      showAlert("success", "Theme settings saved");
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to save theme",
      );
    }
  };

  // Revision actions
  const handleRestoreRevision = async (revNumber: number) => {
    if (
      !window.confirm(
        `Are you sure you want to restore configuration to revision #${revNumber}?`,
      )
    ) {
      return;
    }
    try {
      await restoreCmsRevision(revNumber);
      showAlert("success", `Restored configuration to revision #${revNumber}`);
      await loadAllCmsData();
    } catch (err: unknown) {
      showAlert(
        "danger",
        err instanceof Error ? err.message : "Failed to restore revision",
      );
    }
  };

  if (loading && !session) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <p>Loading administration portal...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ maxWidth: 420, margin: "10vh auto", padding: "2rem" }}>
        <div className="card">
          <div className="sidebar-brand" style={{ marginBottom: "1.5rem" }}>
            <span className="brand-badge">Vault Admin</span>
            <h1>CMS Administration</h1>
            <p
              style={{
                color: "#556b5a",
                fontSize: "0.85rem",
                margin: "0.5rem 0 0",
              }}
            >
              Sign in with your vault administrator session to manage
              presentation, layouts, and theme.
            </p>
          </div>

          {alert && (
            <div className={`alert alert-${alert.type}`}>{alert.message}</div>
          )}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Administrator Email</label>
              <input
                type="email"
                className="form-control"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                Sign In
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRegister}
              >
                Register New
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const filteredSections = sections.filter(
    (s) => screenFilter === "all" || s.screenKey === screenFilter,
  );

  return (
    <div
      className="admin-layout"
      style={{ ["--primary-color" as string]: theme.primaryColor }}
    >
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="brand-badge">Admin Portal</span>
          <h1>Vault CMS</h1>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-button ${activeTab === "sections" ? "active" : ""}`}
            onClick={() => setActiveTab("sections")}
          >
            📐 Sections & Layout
          </button>
          <button
            className={`nav-button ${activeTab === "modules" ? "active" : ""}`}
            onClick={() => setActiveTab("modules")}
          >
            📦 App Modules
          </button>
          <button
            className={`nav-button ${activeTab === "navigation" ? "active" : ""}`}
            onClick={() => setActiveTab("navigation")}
          >
            🧭 Navigation
          </button>
          <button
            className={`nav-button ${activeTab === "theme" ? "active" : ""}`}
            onClick={() => setActiveTab("theme")}
          >
            🎨 Theme & Styling
          </button>
          <button
            className={`nav-button ${activeTab === "revisions" ? "active" : ""}`}
            onClick={() => setActiveTab("revisions")}
          >
            🕒 Revision History
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>Version 1.1 — Phase 6</div>
          <div style={{ marginTop: "0.25rem", color: "#6ee7b7" }}>
            Tenant Isolated
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        <div className="admin-topbar">
          <div className="topbar-title">
            <h2>
              {activeTab === "sections" && "Sections & Layout Configuration"}
              {activeTab === "modules" && "Application Modules"}
              {activeTab === "navigation" && "Navigation Items"}
              {activeTab === "theme" && "Theme & Branding Tokens"}
              {activeTab === "revisions" &&
                "Audit Trail & Configuration Revisions"}
            </h2>
            <p className="topbar-subtitle">
              Declarative configuration rendered strictly through a finite
              trusted component whitelist.
            </p>
          </div>

          <div className="session-info">
            <span className="account-pill">{session.account.email}</span>
            <button className="btn-secondary" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </div>

        <div className="security-banner">
          <span style={{ fontSize: "1.2rem" }}>🛡️</span>
          <div>
            <strong>Zero-Knowledge Security Boundary:</strong> The CMS
            configures presentation and navigation only. Vault records, master
            passwords, VEKs, and attachments are encrypted client-side and never
            touch this portal or the backend unencrypted.
          </div>
        </div>

        {alert && (
          <div className={`alert alert-${alert.type}`}>{alert.message}</div>
        )}

        {/* TAB 1: SECTIONS */}
        {activeTab === "sections" && (
          <div>
            <div className="card">
              <div className="card-header">
                <div>
                  <h3>Dynamic Screen Sections ({filteredSections.length})</h3>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.82rem",
                        color: "#556b5a",
                        alignSelf: "center",
                      }}
                    >
                      Screen:
                    </span>
                    {["all", "vault_overview", "dashboard", "settings"].map(
                      (sk) => (
                        <button
                          key={sk}
                          className={
                            screenFilter === sk
                              ? "btn-primary"
                              : "btn-secondary"
                          }
                          style={{
                            padding: "0.2rem 0.6rem",
                            fontSize: "0.78rem",
                          }}
                          onClick={() => setScreenFilter(sk)}
                        >
                          {sk}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <button
                  className="btn-primary"
                  onClick={() => {
                    setSectionForm({
                      screenKey:
                        screenFilter === "all"
                          ? "vault_overview"
                          : screenFilter,
                      sectionType: "quick_actions",
                      title: "",
                      contentPayloadStr:
                        '{\n  "subtitle": "Quick shortcuts"\n}',
                      styleConfigStr: "{}",
                      displayOrder: (sections.length + 1) * 10,
                      isEnabled: true,
                    });
                    setEditingSection(null);
                    setIsCreatingSection(true);
                  }}
                >
                  + Add Section
                </button>
              </div>

              <table className="card-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Screen</th>
                    <th>Title</th>
                    <th>Component Type</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSections.map((sec) => (
                    <tr key={sec.id}>
                      <td style={{ fontWeight: 600 }}>#{sec.displayOrder}</td>
                      <td>
                        <span className="badge badge-screen">
                          {sec.screenKey}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{sec.title}</td>
                      <td>
                        <code>{sec.sectionType}</code>
                      </td>
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={sec.isEnabled}
                            onChange={() => handleToggleSection(sec)}
                          />
                          <span className="slider"></span>
                        </label>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button
                            className="btn-secondary"
                            style={{
                              padding: "0.25rem 0.5rem",
                              fontSize: "0.78rem",
                            }}
                            onClick={() => {
                              setEditingSection(sec);
                              setSectionForm({
                                screenKey: sec.screenKey,
                                sectionType: sec.sectionType,
                                title: sec.title,
                                contentPayloadStr: JSON.stringify(
                                  sec.contentPayload,
                                  null,
                                  2,
                                ),
                                styleConfigStr: JSON.stringify(
                                  sec.styleConfig,
                                  null,
                                  2,
                                ),
                                displayOrder: sec.displayOrder,
                                isEnabled: sec.isEnabled,
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-danger"
                            onClick={() => handleDeleteSection(sec)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredSections.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          textAlign: "center",
                          color: "#6b7280",
                          padding: "2rem",
                        }}
                      >
                        No sections found for this screen filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: MODULES */}
        {activeTab === "modules" && (
          <div className="card">
            <div className="card-header">
              <h3>Configured Modules ({modules.length})</h3>
            </div>
            <table className="card-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Key</th>
                  <th>Display Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600 }}>#{m.displayOrder}</td>
                    <td>
                      <code>{m.moduleKey}</code>
                    </td>
                    <td style={{ fontWeight: 500 }}>{m.displayName}</td>
                    <td style={{ color: "#556b5a", fontSize: "0.82rem" }}>
                      {m.description || "—"}
                    </td>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={m.isEnabled}
                          onChange={() => handleToggleModule(m)}
                        />
                        <span className="slider"></span>
                      </label>
                    </td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.78rem",
                        }}
                        onClick={() => {
                          setEditingModule(m);
                          setModuleForm({
                            displayName: m.displayName,
                            description: m.description || "",
                            displayOrder: m.displayOrder,
                            isEnabled: m.isEnabled,
                          });
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: NAVIGATION */}
        {activeTab === "navigation" && (
          <div className="card">
            <div className="card-header">
              <h3>Navigation Bar Items ({navigation.length})</h3>
            </div>
            <table className="card-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Label</th>
                  <th>Route</th>
                  <th>Icon</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {navigation.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>#{item.displayOrder}</td>
                    <td style={{ fontWeight: 500 }}>{item.label}</td>
                    <td>
                      <code>{item.routeKey}</code>
                    </td>
                    <td>
                      <code>{item.iconKey}</code>
                    </td>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={item.isEnabled}
                          onChange={() => handleToggleNav(item)}
                        />
                        <span className="slider"></span>
                      </label>
                    </td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.78rem",
                        }}
                        onClick={() => {
                          setEditingNav(item);
                          setNavForm({
                            label: item.label,
                            displayOrder: item.displayOrder,
                            isEnabled: item.isEnabled,
                          });
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: THEME */}
        {activeTab === "theme" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1.5rem",
            }}
          >
            <div className="card">
              <div className="card-header">
                <h3>Theme Settings</h3>
              </div>
              <form onSubmit={handleSaveTheme}>
                <div className="form-group">
                  <label>Preset Style</label>
                  <select
                    className="form-control"
                    value={theme.themePreset}
                    onChange={(e) => {
                      const p = e.target.value;
                      let color = theme.primaryColor;
                      if (p === "emerald") color = "#10b981";
                      if (p === "midnight") color = "#3b82f6";
                      if (p === "nordic") color = "#0284c7";
                      if (p === "slate") color = "#475569";
                      if (p === "default") color = "#1c5230";
                      setTheme({
                        ...theme,
                        themePreset: p,
                        primaryColor: color,
                      });
                    }}
                  >
                    <option value="default">
                      Default Vault (Forest Green)
                    </option>
                    <option value="emerald">Emerald Vibrant</option>
                    <option value="midnight">Midnight Sapphire</option>
                    <option value="nordic">Nordic Arctic Blue</option>
                    <option value="slate">Monochrome Slate</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Primary Brand Color</label>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="color"
                      value={theme.primaryColor}
                      onChange={(e) =>
                        setTheme({ ...theme, primaryColor: e.target.value })
                      }
                      style={{
                        width: 44,
                        height: 38,
                        border: "none",
                        cursor: "pointer",
                      }}
                    />
                    <input
                      type="text"
                      className="form-control"
                      value={theme.primaryColor}
                      onChange={(e) =>
                        setTheme({ ...theme, primaryColor: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Corner Radius</label>
                  <select
                    className="form-control"
                    value={theme.borderRadius}
                    onChange={(e) =>
                      setTheme({ ...theme, borderRadius: e.target.value })
                    }
                  >
                    <option value="4px">4px (Sharp)</option>
                    <option value="8px">8px (Standard)</option>
                    <option value="12px">12px (Smooth)</option>
                    <option value="16px">16px (Rounded)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Layout Density</label>
                  <select
                    className="form-control"
                    value={theme.density}
                    onChange={(e) =>
                      setTheme({ ...theme, density: e.target.value })
                    }
                  >
                    <option value="compact">
                      Compact (High Information Density)
                    </option>
                    <option value="comfortable">Comfortable (Balanced)</option>
                    <option value="spacious">Spacious (Relaxed Touch)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  style={{ marginTop: "0.5rem" }}
                >
                  Save Theme Changes
                </button>
              </form>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Live Theme Preview</h3>
              </div>
              <div
                className="theme-preview-card"
                style={{
                  borderRadius: theme.borderRadius,
                  borderColor: "#c9d8cb",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <span
                    className="color-swatch"
                    style={{ background: theme.primaryColor }}
                  />
                  <strong>Personal Digital Vault</strong>
                </div>
                <p style={{ color: "#556b5a", fontSize: "0.85rem" }}>
                  Theme Preset: <code>{theme.themePreset}</code> • Density:{" "}
                  <code>{theme.density}</code>
                </p>
                <div
                  style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}
                >
                  <button
                    className="btn-primary"
                    style={{
                      background: theme.primaryColor,
                      borderRadius: theme.borderRadius,
                    }}
                  >
                    Primary Button
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ borderRadius: theme.borderRadius }}
                  >
                    Secondary
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: REVISIONS */}
        {activeTab === "revisions" && (
          <div className="card">
            <div className="card-header">
              <h3>Configuration Audit Trail ({revisions.length} Revisions)</h3>
            </div>
            <table className="card-table">
              <thead>
                <tr>
                  <th>Rev #</th>
                  <th>Timestamp</th>
                  <th>Actor Device</th>
                  <th>Change Summary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((rev) => (
                  <tr key={rev.id}>
                    <td style={{ fontWeight: 700 }}>#{rev.revisionNumber}</td>
                    <td style={{ fontSize: "0.82rem", color: "#556b5a" }}>
                      {new Date(rev.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <code>{rev.actorDeviceId || "initial_seed"}</code>
                    </td>
                    <td style={{ fontWeight: 500 }}>{rev.changeSummary}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.78rem",
                        }}
                        onClick={() =>
                          handleRestoreRevision(rev.revisionNumber)
                        }
                      >
                        Restore Revision
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MODAL: SECTION CREATE / EDIT */}
        {(isCreatingSection || editingSection) && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <h3>
                  {editingSection ? "Edit Section" : "Create New Section"}
                </h3>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setIsCreatingSection(false);
                    setEditingSection(null);
                  }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveSection}>
                <div className="form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    className="form-control"
                    value={sectionForm.title}
                    onChange={(e) =>
                      setSectionForm({ ...sectionForm, title: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Target Screen</label>
                    <select
                      className="form-control"
                      value={sectionForm.screenKey}
                      onChange={(e) =>
                        setSectionForm({
                          ...sectionForm,
                          screenKey: e.target.value,
                        })
                      }
                    >
                      <option value="vault_overview">vault_overview</option>
                      <option value="dashboard">dashboard</option>
                      <option value="settings">settings</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Component Whitelist Type</label>
                    <select
                      className="form-control"
                      value={sectionForm.sectionType}
                      disabled={!!editingSection}
                      onChange={(e) =>
                        setSectionForm({
                          ...sectionForm,
                          sectionType: e.target.value,
                        })
                      }
                    >
                      {ALLOWED_SECTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Display Order</label>
                    <input
                      type="number"
                      className="form-control"
                      value={sectionForm.displayOrder}
                      onChange={(e) =>
                        setSectionForm({
                          ...sectionForm,
                          displayOrder: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label>Enabled</label>
                    <div style={{ marginTop: "0.4rem" }}>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={sectionForm.isEnabled}
                          onChange={(e) =>
                            setSectionForm({
                              ...sectionForm,
                              isEnabled: e.target.checked,
                            })
                          }
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Content Payload (JSON)</label>
                  <textarea
                    className="form-control"
                    rows={4}
                    value={sectionForm.contentPayloadStr}
                    onChange={(e) =>
                      setSectionForm({
                        ...sectionForm,
                        contentPayloadStr: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="form-group">
                  <label>Style Config (JSON)</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={sectionForm.styleConfigStr}
                    onChange={(e) =>
                      setSectionForm({
                        ...sectionForm,
                        styleConfigStr: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setIsCreatingSection(false);
                      setEditingSection(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingSection ? "Save Changes" : "Create Section"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: MODULE EDIT */}
        {editingModule && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <h3>Edit Module: {editingModule.moduleKey}</h3>
                <button
                  className="btn-secondary"
                  onClick={() => setEditingModule(null)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveModule}>
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={moduleForm.displayName}
                    onChange={(e) =>
                      setModuleForm({
                        ...moduleForm,
                        displayName: e.target.value,
                      })
                    }
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <input
                    type="text"
                    className="form-control"
                    value={moduleForm.description}
                    onChange={(e) =>
                      setModuleForm({
                        ...moduleForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Display Order</label>
                    <input
                      type="number"
                      className="form-control"
                      value={moduleForm.displayOrder}
                      onChange={(e) =>
                        setModuleForm({
                          ...moduleForm,
                          displayOrder: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label>Enabled</label>
                    <div style={{ marginTop: "0.4rem" }}>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={moduleForm.isEnabled}
                          onChange={(e) =>
                            setModuleForm({
                              ...moduleForm,
                              isEnabled: e.target.checked,
                            })
                          }
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditingModule(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Save Module
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: NAVIGATION EDIT */}
        {editingNav && (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-header">
                <h3>Edit Navigation: {editingNav.label}</h3>
                <button
                  className="btn-secondary"
                  onClick={() => setEditingNav(null)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveNav}>
                <div className="form-group">
                  <label>Label</label>
                  <input
                    type="text"
                    className="form-control"
                    value={navForm.label}
                    onChange={(e) =>
                      setNavForm({ ...navForm, label: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Display Order</label>
                    <input
                      type="number"
                      className="form-control"
                      value={navForm.displayOrder}
                      onChange={(e) =>
                        setNavForm({
                          ...navForm,
                          displayOrder: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label>Enabled</label>
                    <div style={{ marginTop: "0.4rem" }}>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={navForm.isEnabled}
                          onChange={(e) =>
                            setNavForm({
                              ...navForm,
                              isEnabled: e.target.checked,
                            })
                          }
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditingNav(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Save Navigation
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
