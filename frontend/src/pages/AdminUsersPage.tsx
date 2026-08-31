import { useState, type FormEvent } from "react";
import { useCreateUser, useUpdateUser, useUsers } from "../state/hooks/useUsers";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { AdminNav } from "../components/common/AdminNav";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import type { Role, User } from "../types/domain";

const ROLES: Role[] = ["admin", "editor", "viewer"];

type UserSortKey = "username" | "role" | "is_active" | "created_at" | "last_login_at";

function compareUsers(a: User, b: User, key: UserSortKey, dir: "asc" | "desc"): number {
  switch (key) {
    case "username":
      return compareStrings(a.username, b.username, dir);
    case "role":
      return compareStrings(a.role, b.role, dir);
    case "is_active":
      return compareStrings(String(a.is_active), String(b.is_active), dir);
    case "created_at":
      return compareStrings(a.created_at, b.created_at, dir);
    case "last_login_at":
      return compareNullable(a.last_login_at, b.last_login_at, dir);
  }
}

export function AdminUsersPage() {
  const { data: users, isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(users ?? [], compareUsers);

  const [showAddModal, setShowAddModal] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createUser.mutateAsync({ username, password, role });
      setUsername("");
      setPassword("");
      setRole("viewer");
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : "Failed to create user");
    }
  }

  function handleRoleChange(user: User, newRole: Role) {
    void updateUser.mutateAsync({ id: user.id, input: { role: newRole } });
  }

  function handleToggleActive(user: User) {
    void updateUser.mutateAsync({ id: user.id, input: { is_active: !user.is_active } });
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Admin</h1>
        <button onClick={() => setShowAddModal(true)}>+ Create User</button>
      </div>
      <AdminNav />

      {showAddModal && (
        <Modal title="Create User" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-row">
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label className="wide-label">
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {formError && <div className="error-text">{formError}</div>}
            <div className="modal-actions">
              <button type="button" className="icon-button" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button type="submit" disabled={createUser.isPending}>
                Create User
              </button>
            </div>
          </form>
        </Modal>
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}

      {isLoading ? (
        <LoadingState label="Loading users…" />
      ) : (users ?? []).length === 0 ? (
        <EmptyState icon="◇" title="No users yet" message="Create the first user above." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortableColumnHeader label="Username" columnKey="username" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Role" columnKey="role" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Active" columnKey="is_active" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Created" columnKey="created_at" columnType="date" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <SortableColumnHeader label="Last login" columnKey="last_login_at" columnType="date" activeKey={sortKey} activeDir={sortDir} onSort={onSort} onClear={onClear} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <select value={u.role} onChange={(e) => handleRoleChange(u, e.target.value as Role)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={u.is_active ? "status-badge status-validated" : "status-badge status-deprecated"}>
                    {u.is_active ? "active" : "deactivated"}
                  </span>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "never"}</td>
                <td>
                  <button className="link-button" onClick={() => handleToggleActive(u)}>
                    {u.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
