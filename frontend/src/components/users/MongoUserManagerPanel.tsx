import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Trash2, RefreshCw, Shield, Key, Loader2, X } from 'lucide-react';
import { ConnectionConfig } from '../../types/domain';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { alertError, alertSuccess, confirmDialog } from '../../stores/useAlertStore';

interface MongoUserManagerPanelProps {
  connection: ConnectionConfig;
}

interface MongoUserRow {
  _id?: string;
  user: string;
  db: string;
  roles: { role: string; db: string }[];
}

const BUILTIN_ROLES = [
  'read',
  'readWrite',
  'dbAdmin',
  'dbOwner',
  'userAdmin',
  'readAnyDatabase',
  'readWriteAnyDatabase',
  'userAdminAnyDatabase',
  'dbAdminAnyDatabase',
  'clusterAdmin',
  'root',
];

export const MongoUserManagerPanel: React.FC<MongoUserManagerPanelProps> = ({ connection }) => {
  const [authDb, setAuthDb] = useState(connection.databaseName || 'admin');
  const [users, setUsers] = useState<MongoUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<{ role: string; db: string }[]>([
    { role: 'readWrite', db: connection.databaseName || 'admin' },
  ]);

  const execMql = useCallback(
    async (db: string, sql: string) => {
      return QueryService.ExecuteQuery({
        executionId: 'mongo-rbac-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        connectionId: connection.id,
        database: db,
        schema: db,
        sql,
        limit: 200,
        offset: 0,
      } as any);
    },
    [connection.id]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await execMql(authDb, 'db.getUsers();');
      const cols = res?.columns || [];
      const rows = res?.rows || [];
      const list: MongoUserRow[] = rows.map((r: any[] | null) => {
        const obj: Record<string, any> = {};
        cols.forEach((c: any, i: number) => {
          let v = r?.[i];
          if (typeof v === 'string' && (v.trim().startsWith('[') || v.trim().startsWith('{'))) {
            try {
              v = JSON.parse(v);
            } catch {}
          }
          obj[c.name] = v;
        });
        return {
          _id: obj._id,
          user: String(obj.user || ''),
          db: String(obj.db || authDb),
          roles: Array.isArray(obj.roles) ? obj.roles : [],
        };
      });
      setUsers(list.filter((u) => u.user));
    } catch (err: any) {
      setErrorMsg(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [authDb, execMql]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async () => {
    const u = newUsername.trim();
    if (!u || !newPassword) {
      alertError('Username and password are required.', 'Validation Error');
      return;
    }
    try {
      const mql = `db.createUser(${JSON.stringify({
        user: u,
        pwd: newPassword,
        roles: selectedRoles,
      })});`;
      await execMql(authDb, mql);
      alertSuccess(`Created MongoDB user "${u}" in "${authDb}".`, 'User Created');
      setShowCreate(false);
      setNewUsername('');
      setNewPassword('');
      loadUsers();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Create User Failed');
    }
  };

  const handleDropUser = async (u: MongoUserRow) => {
    const ok = await confirmDialog({
      title: 'Drop MongoDB User',
      message: `Drop user "${u.user}" from database "${u.db}"?`,
      confirmLabel: 'Drop User',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await execMql(u.db, `db.dropUser(${JSON.stringify(u.user)});`);
      alertSuccess(`Dropped user "${u.user}".`, 'User Dropped');
      loadUsers();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Drop User Failed');
    }
  };

  const handleChangePassword = async (u: MongoUserRow) => {
    const nextPwd = window.prompt(`Enter new password for ${u.user}@${u.db}:`);
    if (!nextPwd) return;
    try {
      await execMql(u.db, `db.updateUser(${JSON.stringify(u.user)}, ${JSON.stringify({ pwd: nextPwd })});`);
      alertSuccess(`Updated password for "${u.user}".`, 'Password Updated');
    } catch (err: any) {
      alertError(err?.message || String(err), 'Update Password Failed');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#14161d] text-xs overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530] bg-[#101218]">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-zinc-100">MongoDB RBAC Users</span>
          <span className="text-zinc-500 font-mono">({connection.name})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">Auth DB:</span>
            <input
              type="text"
              value={authDb}
              onChange={(e) => setAuthDb(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
              className="w-28 rounded border border-[#2a2d3a] bg-[#0b0c10] px-2 py-1 font-mono text-zinc-100 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={loadUsers}
            className="p-1.5 rounded bg-[#1d202b] hover:bg-[#272b3a] text-zinc-300 cursor-pointer"
            title="Refresh Users"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!connection.isReadOnly && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Create User
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {errorMsg && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300 font-mono">
            {errorMsg}
          </div>
        )}

        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-zinc-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading MongoDB users...
          </div>
        ) : users.length === 0 ? (
          <div className="text-center text-zinc-500 py-12 border border-dashed border-[#242733] rounded-lg">
            No users found in database "{authDb}".
          </div>
        ) : (
          <div className="rounded-lg border border-[#242733] overflow-hidden">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="bg-[#181a22] text-zinc-400 border-b border-[#242733]">
                <tr>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Database</th>
                  <th className="px-3 py-2">Roles</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f222c]">
                {users.map((u, idx) => (
                  <tr key={idx} className="hover:bg-[#181b24]">
                    <td className="px-3 py-2 text-emerald-300 font-semibold">{u.user}</td>
                    <td className="px-3 py-2 text-zinc-300">{u.db}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r, rIdx) => (
                          <span
                            key={rIdx}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                          >
                            <Shield className="w-2.5 h-2.5" />
                            {r.role}@{r.db}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      {!connection.isReadOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleChangePassword(u)}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-300 cursor-pointer"
                            title="Change Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDropUser(u)}
                            className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                            title="Drop User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#282b36] bg-[#14161d] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#222530]">
              <span className="font-semibold text-zinc-100">Create MongoDB User ({authDb})</span>
              <button type="button" onClick={() => setShowCreate(false)} className="text-zinc-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-zinc-400 mb-1">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full rounded border border-[#2a2d3a] bg-[#0b0c10] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded border border-[#2a2d3a] bg-[#0b0c10] px-2.5 py-1.5 text-zinc-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Primary Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={selectedRoles[0]?.role || 'readWrite'}
                    onChange={(e) =>
                      setSelectedRoles([{ role: e.target.value, db: selectedRoles[0]?.db || authDb }])
                    }
                    className="rounded border border-[#2a2d3a] bg-[#0b0c10] px-2 py-1.5 text-zinc-100"
                  >
                    {BUILTIN_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={selectedRoles[0]?.db || authDb}
                    onChange={(e) =>
                      setSelectedRoles([{ role: selectedRoles[0]?.role || 'readWrite', db: e.target.value }])
                    }
                    placeholder="Target DB"
                    className="rounded border border-[#2a2d3a] bg-[#0b0c10] px-2 py-1.5 font-mono text-zinc-100"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#222530]">
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded bg-[#1e212b] text-zinc-300 cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleCreateUser} className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer">
                Create User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
