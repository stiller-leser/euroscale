# AGENTS.md - Euroscale Development Guide

## Repository Structure

- `control-plane/` - Main infrastructure (ArgoCD, Keycloak, OpenBao, Backstage)
- `customer/` - Customer-specific GitOps configs
- `agencies/` - Agency-specific GitOps configs
- `common/tools/` - Shared tooling (Ansible ops)
- `common/scripts/` - Shared scripts (generate-authz-config.mjs)
- `control-plane/docs/` - Always read this directory first for project-specific documentation

## Key Commands

### Control Plane (from `control-plane/`)

```bash
make apply           # Deploy stack via Ansible playbook
make authz-generate  # Generate authZ artifacts (Node.js script)
make authz-test      # Run AuthZ/RBAC live checks
make destroy         # Destroy infrastructure
```

### Backstage Development (from `control-plane/tools/backstage-app/`)

```bash
yarn start           # Start dev server
yarn build:all       # Build all packages
yarn test            # Run tests
yarn lint            # Lint (since origin/master)
yarn lint:all        # Full lint
```

## Important Quirks

- **Node.js**: Requires Node 22 or 24
- **Package Manager**: Yarn 4.4.1 (enable with `corepack enable`)
- **Secrets CLI**: Use `bao` (OpenBao), NOT `vault`
- **IaC**: Uses OpenTofu, not Terraform
- **AuthZ**: Generated via `node ../common/scripts/generate-authz-config.mjs`
- **Ansible Testing**: Use Molecule for testing Ansible roles
- **SPIRE**: Deployed as raw Kustomize manifests via ArgoCD (wave 2), not Helm
- **SPIRE Trust Domain**: `euroscale.svc.id`
- **Workload Identity**: SPIRE CSI driver (`csi.spiffe.io`) makes SPIRE agent socket available to pods
- **OpenBao SPIRE Auth**: Configured via Ansible role `openbao_spire` in site.yml step 14
- **Backstage SPIRE Auth**: Uses sidecar `spire-jwt-fetcher` + `auth/spire/login`; falls back to `auth/kubernetes/login`

## Development Workflow

### Peer Coding Model

This project uses a **peer coding model** where you and the developer collaborate directly. Every code change requires my explicit approval before execution.

**Core Rule**: I will NEVER make changes to files, run commands, or execute workflows without your agreement.

**Workflow for every task**:

1. **You describe the problem or goal** - Tell me what needs to be done
2. **I ask clarifying questions** - I may probe to understand the intent, constraints, or edge cases
3. **I propose a solution** - I describe the approach and show the code/config I plan to use
4. **You approve or redirect** - You review and either approve, ask for changes, or suggest a different approach
5. **Only then I execute** - After you approve, I make the change
6. **Testing** - If tests exist (e.g., `molecule test` for Ansible roles), I run them to verify

**What I will NOT do without asking first**:
- Edit any file
- Create new files or directories
- Run `make apply`, `make destroy`, or similar infrastructure commands
- Commit changes to git
- Delete files
- Run external commands that modify state

**How to approve**:
- Say "yes", "do it", "go ahead", or similar explicit approval
- If you want changes, describe what to adjust

**If you want me to explore first**:
- Say "explore" or "investigate" and I'll search/read without making changes
- Once exploration is done, we'll discuss before any changes

### Backstage Development

For Backstage-specific work from `control-plane/tools/backstage-app/`:

```bash
yarn start           # Start dev server
yarn build:all       # Build all packages
yarn test            # Run tests
yarn lint            # Lint (since origin/master)
yarn lint:all        # Full lint
```