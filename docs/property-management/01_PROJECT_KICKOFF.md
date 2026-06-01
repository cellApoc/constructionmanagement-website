# Meridian Properties — Full Stack Application Kickoff

## Project Overview
Convert the static Meridian Properties website into a full-stack React + Express + PostgreSQL application deployed on AWS.

**Brand**: Meridian Properties — Premier Property Management
**Fonts**: Cormorant Garamond (headings) + Inter (body)

## Current Static Site Pages
- Landing (index.html) — Hero, featured properties, services, testimonials
- About, Rentals, Condos & HOA, Residents, Owners, Amenities, Contact
- 5-step Tenant Application wizard

## Featured Properties
| Property | Location | Type | Price |
|----------|----------|------|-------|
| The Ashford | Downtown | Luxury Apartments | From $2,400/month |
| Meridian Tower | Midtown | Condominiums | From $450,000 |
| The Linden | Waterfront | Townhomes | From $3,100/month |

## Services
1. Rental Management
2. HOA Administration
3. Resident Services
4. Owner Relations

## User Roles
| Role | Description |
|------|-------------|
| admin | Full system access |
| property_manager | CRUD properties/units/leases, approve applications |
| maintenance_worker | View/update assigned maintenance tasks |
| tenant | View lease, pay rent, submit maintenance requests |
| owner | View property performance, financials |

## Features
### Public Pages (no login)
- Marketing pages (converted from static HTML to React)
- Property listings with search/filter
- Tenant application wizard (5-step form)

### Dashboard (authenticated)
- Property & Unit management (CRUD)
- Tenant management & lease tracking
- Rent payment tracking
- Maintenance request workflow (Submit > Assign > Complete)
- Application processing (Review > Approve/Reject)
- Owner portal with financials
- Reports & dashboard analytics
- User management & settings

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + React Router + Lucide Icons |
| Backend | Express.js (Node.js 20) |
| Database | PostgreSQL (Aurora Serverless v2, IAM auth) |
| Auth | JWT + bcrypt |
| IDs | UUID v4 |

## Infrastructure
Same AWS account (515206814213) + same Cloudflare account.
Same Aurora cluster (database-1), same postgres database.
New tables use pm_ prefix to avoid collisions with construction mgmt tables.
New EB environment (pm-prod), new CF Pages project, new CF Worker proxy.
