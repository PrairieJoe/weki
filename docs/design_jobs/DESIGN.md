---
name: Weki System Identity
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#454652'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#767683'
  outline-variant: '#c6c5d4'
  surface-tint: '#4c56af'
  primary: '#000666'
  on-primary: '#ffffff'
  primary-container: '#1a237e'
  on-primary-container: '#8690ee'
  inverse-primary: '#bdc2ff'
  secondary: '#4355b9'
  on-secondary: '#ffffff'
  secondary-container: '#8596ff'
  on-secondary-container: '#11278e'
  tertiary: '#380b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#5c1800'
  on-tertiary-container: '#e17c5a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bdc2ff'
  on-primary-fixed: '#000767'
  on-primary-fixed-variant: '#343d96'
  secondary-fixed: '#dee0ff'
  secondary-fixed-dim: '#bac3ff'
  on-secondary-fixed: '#00105c'
  on-secondary-fixed-variant: '#293ca0'
  tertiary-fixed: '#ffdbd0'
  tertiary-fixed-dim: '#ffb59d'
  on-tertiary-fixed: '#390c00'
  on-tertiary-fixed-variant: '#7b2e12'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
  status-pending: '#9E9E9E'
  status-processing: '#2196F3'
  status-paused: '#FF9800'
  status-success: '#4CAF50'
  status-partial: '#FFB300'
  status-failed: '#D32F2F'
  status-warning: '#ED6C02'
  source-native: '#E8EAF6'
  source-user: '#F3E5F5'
  relevance-high: '#1B5E20'
typography:
  headline-lg:
    fontFamily: IBM Plex Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: IBM Plex Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  evidence-text:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 24px
  metadata-label:
    fontFamily: IBM Plex Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  metric-value:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 20px
  system-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  sidebar-width: 260px
  container-max-width: 1200px
  gutter: 1rem
  stack-gap: 0.75rem
  card-padding: 1.25rem
---

## Brand & Style

The design system is engineered for **Weki**, a local-first knowledge retrieval platform that prioritizes empirical evidence over generative speculation. The brand personality is **Professional, Technical, and Authoritative**, aimed at knowledge workers who require a "source of truth" rather than a conversational assistant. 

The aesthetic follows a **Modern Corporate** direction, blending the structural rigidity of professional Windows desktop applications with the clarity of contemporary SaaS. It emphasizes "Recall-First" values through high information density, clear logical grouping, and a focus on provenance. The emotional response is one of stability and absolute reliability—user data is treated as a high-value asset that is indexed and retrieved with surgical precision.

## Colors

The palette is anchored by **Deep Indigo (#1A237E)** to establish a sense of institutional stability and trust. **Clean White** and **Cool Grays** serve as the canvas for focus-heavy work. 

A comprehensive semantic system is used to communicate the state of the local processing engine:
- **Primary Indigo:** Used for structural elements, headers, and primary actions.
- **Status Tints:** Distinct hues for the processing queue (Processing Blue, Partial Warning Amber, Success Green).
- **Source Badges:** Subtle, low-saturation tints used to differentiate between system-generated metadata and user-modified entries without distracting from the document content.

## Typography

This design system utilizes **IBM Plex Sans** as the primary typeface for its exceptional legibility in both Korean and English and its "industrial-humanist" aesthetic. It conveys the technical precision of a local-first system while remaining accessible.

**JetBrains Mono** is employed for specific data-driven roles: search relevance scores, file paths, and OCR confidence levels. This distinction helps the user subconsciously separate "content" (Plex) from "metadata and system metrics" (Mono).

- **Evidence-First Hierarchy:** Headings are bold but compact. 
- **Body Text:** Optimized for long-form reading within "Evidence Cards."
- **Metadata Labels:** Always presented in Uppercase with slight letter spacing to act as structural anchors.

## Layout & Spacing

The layout follows a **Fixed-Sidebar Fluid-Content** model characteristic of Windows productivity software. 

- **Navigation:** A 260px left sidebar handles high-level navigation (Search, Library, Jobs, Settings).
- **Search Workspace:** Uses a centered fluid container with a maximum width of 1200px to prevent excessive line lengths in evidence cards.
- **Rhythm:** A strict 4px/8px baseline grid maintains density. Search results use a "Stack" layout with a `0.75rem` gap, allowing users to scan multiple "Evidence Cards" quickly.
- **Responsive Behavior:** 
  - **Desktop (1280px+):** Full 2-column view.
  - **Tablet/Compact (768px-1279px):** Sidebar collapses to icons; margins reduce to 16px.
  - **Grid:** Evidence cards utilize internal nesting for metadata/actions rather than a traditional multi-column grid.

## Elevation & Depth

To maintain a "Professional & Grounded" feel, the system avoids dramatic shadows or translucency, opting for **Tonal Layers** and **Structural Outlines**.

- **Level 0 (Surface):** The main application background (#F8F9FA).
- **Level 1 (Cards/Sidebar):** White surfaces with a fine `1px` border (#E0E0E0).
- **Level 2 (Active/Hover):** Subtlest possible ambient shadow (4px blur, 4% opacity) to indicate interactivity.
- **Evidence Boxes:** Inset depth using a light gray background (#F1F3F4) to visually "nest" raw document text within a result card.
- **Modals:** Use a solid dimming overlay (60% Indigo-Black) to force focus during critical "Exclusive Operations" like backup or restoration.

## Shapes

The design system uses a **Soft (0.25rem)** roundedness level. This choice strikes a balance between the modern expectation of "user-friendly" software and the sharp, professional precision required for a data-intensive tool. 

- **Buttons & Inputs:** `4px` radius.
- **Evidence Cards:** `8px` (rounded-lg) to provide clear visual separation from the background.
- **Status Badges:** `2px` (nearly sharp) to differentiate them from interactive elements like buttons.

## Components

### Evidence Cards
The primary unit of the system. 
- **Header:** File name (Primary Indigo) + File Icon + Relevance Score.
- **Body:** The "Context Box"—raw text from the document with search terms highlighted in a subtle amber background.
- **Footer:** Metadata (Page number, Source type) and a binary feedback group [Relevant / Not Relevant].

### Search Interface
- **Chat Input:** A persistent field at the bottom or top with a prominent "Local Search" indicator. 
- **Job Queue:** A compact, collapsible bar showing real-time progress of OCR and indexing tasks with a `Status-Processing` motion indicator.

### Document Management Tables
- High-density rows with fixed headers.
- **Status Column:** Uses semantic colored dots (e.g., Red for `Source Missing`).
- **Quick Actions:** Hover-triggered buttons for "Open Original" or "Reprocess."

### Buttons & Inputs
- **Primary:** Solid Deep Indigo with white text.
- **Secondary:** Outlined with 1px Deep Indigo.
- **Feedback Buttons:** Ghost buttons that transition to a solid state upon selection to reinforce the feedback loop.
- **Inputs:** Clear focus state using a 2px Primary Indigo border; no drop shadows.

### Banners
- Used for "Partial Failure" warnings. They appear at the top of the search results list, spanning the full width of the content container, utilizing a `Status-Warning` background with bold `system-mono` text.