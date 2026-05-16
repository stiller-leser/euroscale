# K0s Molecule Integration Tests

## Goal
Test K8s-coupled Ansible roles (`spire`, `openbao_spire`, `openbao`, `openbao_bootstrap`, `keycloak`, `kcp`, etc.) by spinning up a real K8s cluster inside a Molecule Docker container using k0s.

## Why k0s (not kind)
- Single binary, no Docker dependency inside the container
- `k0s server --single` boots a fully compliant K8s API
- Works well inside a Molecule Docker container (Ubuntu 24.04)

## Implementation Steps

### 1. Create shared driver playbooks

New directory: `common/tools/ansible/molecule_k0s/`

#### `create.yml`
Installs k0s on the Molecule container:
```yaml
- name: Download k0s
  get_url:
    url: https://github.com/k0sproject/k0s/releases/download/v1.32.2/k0s-v1.32.2-amd64
    dest: /usr/local/bin/k0s
    mode: '0755'
- name: Start k0s controller (single node)
  command: k0s server --single
  async: 60
  poll: 5
- name: Wait for API
  command: k0s kubectl get nodes
  retries: 30
  delay: 5
  until: result.rc == 0
- name: Install k0s kubeconfig
  copy:
    src: /var/lib/k0s/pki/admin.conf
    dest: /root/.kube/config
```

#### `destroy.yml`
Stops and cleans up:
```yaml
- name: Stop k0s
  command: k0s stop
  ignore_errors: true
```

#### `prepare.yml` (optional)
Install `kubectl` + `helm` + other tools the roles depend on.

### 2. Configure Molecule scenarios with delegated driver

Each K8s-dependent role gets a new Molecule scenario referencing the shared playbooks.

#### `molecule/spire/molecule.yml`
```yaml
---
driver:
  name: delegated
  options:
    managed: false
    ansible_args:
      - --extra-vars
      - "@../../molecule_k0s/vars.yml"
  playbooks:
    create: ../molecule_k0s/create.yml
    destroy: ../molecule_k0s/destroy.yml
platforms:
  - name: molecule-test
provisioner:
  name: ansible
verifier:
  name: ansible
```

#### `molecule/spire/converge.yml`
```yaml
---
- name: Converge
  hosts: molecule-test
  tasks:
    - name: Import spire role
      import_role:
        name: spire
```

#### `molecule/spire/verify.yml`
```yaml
---
- name: Verify
  hosts: molecule-test
  tasks:
    - name: Check SPIRE server is healthy
      command: kubectl -n spire-system exec statefulset/spire-server -- /opt/spire/bin/spire-server healthcheck
```

### 3. Target roles (ordered by dependency)

| Wave | Role | Depends on |
|------|------|-----------|
| 1 | `spire` | k0s |
| 2 | `openbao` | k0s |
| 3 | `openbao_bootstrap` | k0s, OpenBao |
| 4 | `openbao_spire` | k0s, SPIRE, OpenBao |
| 5 | `keycloak_password_reset` | k0s, Keycloak operator |
| 6 | `credentials` | k0s, ArgoCD |
| 7 | `kcp` | k0s, KCP CRDs |

Start with waves 1-4 (SPIRE-related roles). They don't need Keycloak/ArgoCD.

### 4. Test execution

```bash
# Test a single role
molecule test --scenario-name spire

# Test all
molecule test --all
```

## Constraints & Risks
- **k0s inside Docker**: `k0s server --single` may need `--disable-components metrics-server` and cgroup v2 support. Use `privileged: true` on the Molecule container if needed. Fallback: kind in Docker (well-documented, widely used).
- **No image registry**: k0s in Docker can't pull from a local registry. Roles that push images (backstage build) won't work here.
- **Stateful setup**: Roles like `openbao_bootstrap` need secrets from earlier roles. Each scenario must be self-contained or chain via the prepare phase.
- **molecule-kind driver**: Obsolete (last commit Jan 2024, 4 commits total). Use delegated driver instead.

## Quick Win
Start with `spire` + `openbao_spire`. If k0s-in-Docker proves problematic, swap to kind.
