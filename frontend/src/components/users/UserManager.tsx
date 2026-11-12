import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  User,
  UserPlus,
  Shield,
  Key,
  Trash2,
  RefreshCw,
  Search,
  Lock,
  Unlock,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  AlertCircle,
  FileCode,
  X,
} from 'lucide-react';
import { ConnectionConfig, WorkbenchTab, resolveConnectionEnv } from '../../types/domain';
import { QueryService } from '../../../bindings/dhub/internal/services';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { alertSuccess, alertError, alertWarning, confirmDialog } from '../../stores/useAlertStore';

interface UserManagerProps {
  tab: WorkbenchTab;
  connection: ConnectionConfig | null;
}

interface DatabaseUser {
  username: string;
  host?: string;
  isLocked?: boolean;
  plugin?: string;
  isSuperuser?: boolean;
  canLogin?: boolean;
  canCreateDb?: boolean;
  canCreateRole?: boolean;
  connLimit?: number;
}

const MYSQL_OBJECT_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'CREATE VIEW',
  'SHOW VIEW',
  'CREATE ROUTINE',
  'ALTER ROUTINE',
  'EXECUTE',
  'EVENT',
  'TRIGGER',
];

const MYSQL_ADMIN_PRIVILEGES = [
  'ALL PRIVILEGES',
  'RELOAD',
  'SHUTDOWN',
  'PROCESS',
  'FILE',
  'SHOW DATABASES',
  'SUPER',
  'CREATE TEMPORARY TABLES',
  'LOCK TABLES',
  'REPLICATION SLAVE',
  'REPLICATION CLIENT',
  'CREATE USER',
];

function generateSecurePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

const isMySQLLike = (driver?: string) => driver === 'mysql' || driver === 'mariadb';

export const UserManager: React.FC<UserManagerProps> = ({ tab, connection }) => {
  const { treeDatabases } = useConnectionStore();
  const availableDatabases = useMemo(() => {
    if (!connection) return [];
    return treeDatabases[connection.id] || (connection.databaseName ? [connection.databaseName] : []);
  }, [connection, treeDatabases]);

  const [users, setUsers] = useState<DatabaseUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create User Modal State
  const [createModal, setCreateModal] = useState<{
    isOpen: boolean;
    username: string;
    host: string;
    password: string;
    showPassword: boolean;
    preset: 'readonly' | 'readwrite' | 'admin' | 'custom';
    selectedPrivileges: string[];
    dbScope: string;
    // Postgres specific
    pgSuperuser: boolean;
    pgCreateDb: boolean;
    pgCreateRole: boolean;
    pgCanLogin: boolean;
    isExecuting: boolean;
  }>({
    isOpen: false,
    username: '',
    host: '%',
    password: '',
    showPassword: false,
    preset: 'readwrite',
    selectedPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    dbScope: '*.*',
    pgSuperuser: false,
    pgCreateDb: false,
    pgCreateRole: false,
    pgCanLogin: true,
    isExecuting: false,
  });

  // Edit Permissions Modal State
  const [permissionModal, setPermissionModal] = useState<{
    isOpen: boolean;
    user: DatabaseUser | null;
    rawGrants: string[];
    isLoadingGrants: boolean;
    dbScope: string;
    selectedPrivileges: string[];
    withGrantOption: boolean;
    // Postgres specific
    pgSuperuser: boolean;
    pgCreateDb: boolean;
    pgCreateRole: boolean;
    pgCanLogin: boolean;
    isExecuting: boolean;
  }>({
    isOpen: false,
    user: null,
    rawGrants: [],
    isLoadingGrants: false,
    dbScope: '*.*',
    selectedPrivileges: [],
    withGrantOption: false,
    pgSuperuser: false,
    pgCreateDb: false,
    pgCreateRole: false,
    pgCanLogin: true,
    isExecuting: false,
  });

  // Change Password Modal State
  const [passwordModal, setPasswordModal] = useState<{
    isOpen: boolean;
    user: DatabaseUser | null;
    password: string;
    showPassword: boolean;
    isExecuting: boolean;
  }>({
    isOpen: false,
    user: null,
    password: '',
    showPassword: false,
    isExecuting: false,
  });

  const loadUsers = async () => {
    if (!connection) return;
    if (connection.driver === 'sqlite' || connection.driver === 'redis' || connection.driver === 'mssql' || connection.driver === 'mongodb') {
      setUsers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const execId = `list-users-${Date.now()}`;
    const targetDb = connection.databaseName || (connection.driver === 'postgres' ? 'postgres' : 'mysql');
    const targetSchema = connection.driver === 'postgres' ? 'public' : 'main';

    try {
      if (isMySQLLike(connection.driver)) {
        let res: any = null;
        try {
          res = await QueryService.ExecuteQuery({
            executionId: execId,
            connectionId: connection.id,
            database: targetDb,
            schema: targetSchema,
            sql: `SELECT user, host, account_locked, plugin FROM mysql.user ORDER BY user, host;`,
            limit: 500,
            offset: 0,
          } as any);
        } catch {
          // Fallback if older MySQL without account_locked or plugin
          res = await QueryService.ExecuteQuery({
            executionId: `${execId}-fallback`,
            connectionId: connection.id,
            database: targetDb,
            schema: targetSchema,
            sql: `SELECT user, host FROM mysql.user ORDER BY user, host;`,
            limit: 500,
            offset: 0,
          } as any);
        }

        if (res && res.rows) {
          const parsed: DatabaseUser[] = (res.rows as any[]).filter(Boolean).map((r: any) => ({
            username: String(r[0] ?? ''),
            host: String(r[1] ?? '%'),
            isLocked: r[2] === 'Y',
            plugin: r[3] ? String(r[3]) : undefined,
          }));
          setUsers(parsed);
        }
      } else if (connection.driver === 'postgres') {
        const res = await QueryService.ExecuteQuery({
          executionId: execId,
          connectionId: connection.id,
          database: targetDb,
          schema: targetSchema,
          sql: `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolconnlimit FROM pg_roles ORDER BY rolname;`,
          limit: 500,
          offset: 0,
        } as any);

        if (res && res.rows) {
          const parsed: DatabaseUser[] = (res.rows as any[]).filter(Boolean).map((r: any) => ({
            username: String(r[0] ?? ''),
            isSuperuser: !!r[1],
            canCreateRole: !!r[3],
            canCreateDb: !!r[4],
            canLogin: !!r[5],
            connLimit: typeof r[6] === 'number' ? r[6] : undefined,
          }));
          setUsers(parsed);
        }
      }
    } catch (err: any) {
      console.error('Failed to list database users:', err);
      setErrorMessage(err?.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [connection?.id]);

  // Open Create User Modal
  const handleOpenCreateModal = () => {
    const generated = generateSecurePassword(14);
    setCreateModal({
      isOpen: true,
      username: '',
      host: '%',
      password: generated,
      showPassword: true,
      preset: 'readwrite',
      selectedPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      dbScope: '*.*',
      pgSuperuser: false,
      pgCreateDb: false,
      pgCreateRole: false,
      pgCanLogin: true,
      isExecuting: false,
    });
  };

  // Preset Selection for Create Modal
  const handleSelectCreatePreset = (preset: 'readonly' | 'readwrite' | 'admin' | 'custom') => {
    let privs: string[] = [];
    if (preset === 'readonly') privs = ['SELECT'];
    else if (preset === 'readwrite') privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    else if (preset === 'admin') privs = ['ALL PRIVILEGES'];
    setCreateModal((prev) => ({
      ...prev,
      preset,
      selectedPrivileges: privs,
    }));
  };

  // Submit Create User
  const handleConfirmCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connection) return;

    const uname = createModal.username.trim();
    if (!uname) {
      alertWarning('Please enter a username.');
      return;
    }

    setCreateModal((prev) => ({ ...prev, isExecuting: true }));
    const execId = `create-user-${Date.now()}`;
    const targetDb = connection.databaseName || (connection.driver === 'postgres' ? 'postgres' : 'mysql');
    const targetSchema = connection.driver === 'postgres' ? 'public' : 'main';

    try {
      if (isMySQLLike(connection.driver)) {
        const host = createModal.host.trim() || '%';
        const pass = createModal.password;
        const passClause = pass ? ` IDENTIFIED BY '${pass.replace(/'/g, "\\'")}'` : '';
        const createSql = `CREATE USER \`${uname}\`@\`${host}\`${passClause};`;

        let grantSql = '';
        if (createModal.selectedPrivileges.length > 0) {
          const privsStr = createModal.selectedPrivileges.includes('ALL PRIVILEGES')
            ? 'ALL PRIVILEGES'
            : createModal.selectedPrivileges.join(', ');
          const scope = createModal.dbScope === '*.*' ? '*.*' : `\`${createModal.dbScope}\`.*`;
          grantSql = `GRANT ${privsStr} ON ${scope} TO \`${uname}\`@\`${host}\`;`;
        }

        const fullSql = `${createSql} ${grantSql} FLUSH PRIVILEGES;`;

        await QueryService.ExecuteQuery({
          executionId: execId,
          connectionId: connection.id,
          database: targetDb,
          schema: targetSchema,
          sql: fullSql,
          limit: 10,
          offset: 0,
        } as any);

        alertSuccess(`User '${uname}'@'${host}' created successfully.`, 'User Created');
      } else if (connection.driver === 'postgres') {
        const passClause = createModal.password ? ` PASSWORD '${createModal.password.replace(/'/g, "''")}'` : '';
        const loginClause = createModal.pgCanLogin ? ' LOGIN' : ' NOLOGIN';
        const superClause = createModal.pgSuperuser ? ' SUPERUSER' : ' NOSUPERUSER';
        const dbClause = createModal.pgCreateDb ? ' CREATEDB' : ' NOCREATEDB';
        const roleClause = createModal.pgCreateRole ? ' CREATEROLE' : ' NOCREATEROLE';

        const sql = `CREATE ROLE "${uname}" WITH${loginClause}${superClause}${dbClause}${roleClause}${passClause};`;

        await QueryService.ExecuteQuery({
          executionId: execId,
          connectionId: connection.id,
          database: targetDb,
          schema: targetSchema,
          sql,
          limit: 10,
          offset: 0,
        } as any);

        alertSuccess(`Role/User "${uname}" created successfully.`, 'User Created');
      }

      setCreateModal((prev) => ({ ...prev, isOpen: false, isExecuting: false }));
      await loadUsers();
    } catch (err: any) {
      setCreateModal((prev) => ({ ...prev, isExecuting: false }));
      alertError(err?.message || String(err), 'Failed to Create User');
    }
  };

  // Open Permission Modal
  const handleOpenPermissionModal = async (u: DatabaseUser) => {
    if (!connection) return;

    setPermissionModal({
      isOpen: true,
      user: u,
      rawGrants: [],
      isLoadingGrants: true,
      dbScope: '*.*',
      selectedPrivileges: [],
      withGrantOption: false,
      pgSuperuser: !!u.isSuperuser,
      pgCreateDb: !!u.canCreateDb,
      pgCreateRole: !!u.canCreateRole,
      pgCanLogin: u.canLogin !== false,
      isExecuting: false,
    });

    if (isMySQLLike(connection.driver)) {
      try {
        const host = u.host || '%';
        const targetDb = connection.databaseName || 'mysql';
        const res = await QueryService.ExecuteQuery({
          executionId: `grants-${Date.now()}`,
          connectionId: connection.id,
          database: targetDb,
          schema: 'main',
          sql: `SHOW GRANTS FOR \`${u.username}\`@\`${host}\`;`,
          limit: 100,
          offset: 0,
        } as any);

        const grants = ((res?.rows || []) as any[]).filter(Boolean).map((r: any) => String(r[0] ?? ''));
        const hasAll = grants.some((g) => g.toUpperCase().includes('ALL PRIVILEGES'));
        const detectedPrivs: string[] = [];

        if (hasAll) {
          detectedPrivs.push('ALL PRIVILEGES');
        } else {
          [...MYSQL_OBJECT_PRIVILEGES, ...MYSQL_ADMIN_PRIVILEGES].forEach((p) => {
            if (p !== 'ALL PRIVILEGES' && grants.some((g) => g.toUpperCase().includes(p))) {
              detectedPrivs.push(p);
            }
          });
        }

        const withGrant = grants.some((g) => g.toUpperCase().includes('WITH GRANT OPTION'));

        setPermissionModal((prev) => ({
          ...prev,
          rawGrants: grants,
          selectedPrivileges: detectedPrivs,
          withGrantOption: withGrant,
          isLoadingGrants: false,
        }));
      } catch (err: any) {
        console.warn('Could not load raw grants:', err);
        setPermissionModal((prev) => ({ ...prev, isLoadingGrants: false }));
      }
    } else {
      setPermissionModal((prev) => ({ ...prev, isLoadingGrants: false }));
    }
  };

  // Toggle privilege checkbox in permission modal
  const handleTogglePrivilege = (priv: string) => {
    setPermissionModal((prev) => {
      const current = prev.selectedPrivileges;
      if (priv === 'ALL PRIVILEGES') {
        return {
          ...prev,
          selectedPrivileges: current.includes('ALL PRIVILEGES') ? [] : ['ALL PRIVILEGES'],
        };
      }
      const withoutAll = current.filter((p) => p !== 'ALL PRIVILEGES');
      if (withoutAll.includes(priv)) {
        return {
          ...prev,
          selectedPrivileges: withoutAll.filter((p) => p !== priv),
        };
      }
      return {
        ...prev,
        selectedPrivileges: [...withoutAll, priv],
      };
    });
  };

  // Submit Save Permissions
  const handleConfirmSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    const { user, dbScope, selectedPrivileges, withGrantOption, isExecuting } = permissionModal;
    if (!connection || !user || isExecuting) return;

    setPermissionModal((prev) => ({ ...prev, isExecuting: true }));
    const execId = `update-perm-${Date.now()}`;
    const targetDb = connection.databaseName || (connection.driver === 'postgres' ? 'postgres' : 'mysql');
    const targetSchema = connection.driver === 'postgres' ? 'public' : 'main';

    try {
      if (isMySQLLike(connection.driver)) {
        const host = user.host || '%';
        const scope = dbScope === '*.*' ? '*.*' : `\`${dbScope}\`.*`;
        const grantOpt = withGrantOption ? ' WITH GRANT OPTION' : '';

        // Revoke existing on this scope and re-grant chosen privileges
        let sql = '';
        if (selectedPrivileges.length === 0) {
          sql = `REVOKE ALL PRIVILEGES, GRANT OPTION FROM \`${user.username}\`@\`${host}\`; FLUSH PRIVILEGES;`;
        } else {
          const privsStr = selectedPrivileges.includes('ALL PRIVILEGES')
            ? 'ALL PRIVILEGES'
            : selectedPrivileges.join(', ');
          sql = `GRANT ${privsStr} ON ${scope} TO \`${user.username}\`@\`${host}\`${grantOpt}; FLUSH PRIVILEGES;`;
        }

        await QueryService.ExecuteQuery({
          executionId: execId,
          connectionId: connection.id,
          database: targetDb,
          schema: targetSchema,
          sql,
          limit: 10,
          offset: 0,
        } as any);

        alertSuccess(`Permissions updated for '${user.username}'@'${host}'.`, 'Permissions Updated');
      } else if (connection.driver === 'postgres') {
        const superClause = permissionModal.pgSuperuser ? ' SUPERUSER' : ' NOSUPERUSER';
        const dbClause = permissionModal.pgCreateDb ? ' CREATEDB' : ' NOCREATEDB';
        const roleClause = permissionModal.pgCreateRole ? ' CREATEROLE' : ' NOCREATEROLE';
        const loginClause = permissionModal.pgCanLogin ? ' LOGIN' : ' NOLOGIN';

        const sql = `ALTER ROLE "${user.username}" WITH${superClause}${dbClause}${roleClause}${loginClause};`;

        await QueryService.ExecuteQuery({
          executionId: execId,
          connectionId: connection.id,
          database: targetDb,
          schema: targetSchema,
          sql,
          limit: 10,
          offset: 0,
        } as any);

        alertSuccess(`Permissions updated for role "${user.username}".`, 'Permissions Updated');
      }

      setPermissionModal((prev) => ({ ...prev, isOpen: false, isExecuting: false }));
      await loadUsers();
    } catch (err: any) {
      setPermissionModal((prev) => ({ ...prev, isExecuting: false }));
      alertError(err?.message || String(err), 'Failed to Update Permissions');
    }
  };

  // Toggle Account Lock (MySQL / MariaDB only)
  const handleToggleLockAccount = async (u: DatabaseUser) => {
    if (!connection || !isMySQLLike(connection.driver)) return;
    const host = u.host || '%';
    const action = u.isLocked ? 'ACCOUNT UNLOCK' : 'ACCOUNT LOCK';
    const actionLabel = u.isLocked ? 'Unlock' : 'Lock';

    const ok = await confirmDialog({
      title: `${actionLabel} User Account`,
      message: `Are you sure you want to ${actionLabel.toLowerCase()} user account '${u.username}'@'${host}'?`,
      confirmLabel: actionLabel,
    });
    if (!ok) return;

    try {
      const sql = `ALTER USER \`${u.username}\`@\`${host}\` ${action}; FLUSH PRIVILEGES;`;
      await QueryService.ExecuteQuery({
        executionId: `lock-${Date.now()}`,
        connectionId: connection.id,
        database: connection.databaseName || 'mysql',
        schema: 'main',
        sql,
        limit: 10,
        offset: 0,
      } as any);

      alertSuccess(`Account '${u.username}'@'${host}' has been ${u.isLocked ? 'unlocked' : 'locked'}.`);
      await loadUsers();
    } catch (err: any) {
      alertError(err?.message || String(err), `Failed to ${actionLabel} Account`);
    }
  };

  // Open Password Modal
  const handleOpenPasswordModal = (u: DatabaseUser) => {
    setPasswordModal({
      isOpen: true,
      user: u,
      password: generateSecurePassword(14),
      showPassword: true,
      isExecuting: false,
    });
  };

  // Confirm Change Password
  const handleConfirmChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const { user, password, isExecuting } = passwordModal;
    if (!connection || !user || isExecuting) return;

    if (!password) {
      alertWarning('Password cannot be empty.');
      return;
    }

    setPasswordModal((prev) => ({ ...prev, isExecuting: true }));
    const execId = `chpass-${Date.now()}`;
    const targetDb = connection.databaseName || (connection.driver === 'postgres' ? 'postgres' : 'mysql');
    const targetSchema = connection.driver === 'postgres' ? 'public' : 'main';

    try {
      let sql = '';
      if (isMySQLLike(connection.driver)) {
        const host = user.host || '%';
        sql = `ALTER USER \`${user.username}\`@\`${host}\` IDENTIFIED BY '${password.replace(/'/g, "\\'")}'; FLUSH PRIVILEGES;`;
      } else if (connection.driver === 'postgres') {
        sql = `ALTER ROLE "${user.username}" WITH PASSWORD '${password.replace(/'/g, "''")}';`;
      }

      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connection.id,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      alertSuccess(`Password updated for user "${user.username}".`, 'Password Changed');
      setPasswordModal((prev) => ({ ...prev, isOpen: false, isExecuting: false }));
    } catch (err: any) {
      setPasswordModal((prev) => ({ ...prev, isExecuting: false }));
      alertError(err?.message || String(err), 'Failed to Change Password');
    }
  };

  // Delete User
  const handleDeleteUser = async (u: DatabaseUser) => {
    if (!connection) return;

    const identifier =
      isMySQLLike(connection.driver)
        ? `'${u.username}'@'${u.host || '%'}'`
        : `"${u.username}"`;

    const ok = await confirmDialog({
      title: 'Delete User Account',
      message: `Are you sure you want to permanently delete user account ${identifier}? All privileges granted to this user will be revoked immediately. This action cannot be undone.`,
      confirmLabel: 'Delete User',
      isDanger: true,
    });
    if (!ok) return;

    const execId = `del-user-${Date.now()}`;
    const targetDb = connection.databaseName || (connection.driver === 'postgres' ? 'postgres' : 'mysql');
    const targetSchema = connection.driver === 'postgres' ? 'public' : 'main';

    try {
      const sql =
        isMySQLLike(connection.driver)
          ? `DROP USER \`${u.username}\`@\`${u.host || '%'}\`;`
          : `DROP ROLE "${u.username}";`;

      await QueryService.ExecuteQuery({
        executionId: execId,
        connectionId: connection.id,
        database: targetDb,
        schema: targetSchema,
        sql,
        limit: 10,
        offset: 0,
      } as any);

      alertSuccess(`User ${identifier} has been deleted.`, 'User Deleted');
      await loadUsers();
    } catch (err: any) {
      alertError(err?.message || String(err), 'Failed to Delete User');
    }
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.host && u.host.toLowerCase().includes(q)) ||
        (u.plugin && u.plugin.toLowerCase().includes(q))
    );
  }, [users, searchQuery]);

  if (!connection) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#191a20] text-zinc-500 text-sm">
        Connection not found or no longer available.
      </div>
    );
  }

  // Redis Message
  if (connection.driver === 'redis') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#191a20] p-6 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-4 shadow-lg">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h3 className="text-base font-semibold text-zinc-100 mb-1">
          Redis User Management
        </h3>
        <p className="text-xs text-zinc-400 max-w-md leading-relaxed mb-4">
          Redis uses Access Control Lists (Redis 6+ ACL) or legacy AUTH passwords. You can manage users and credentials directly in the Query Console using commands such as <code className="font-mono text-zinc-200">ACL LIST</code>, <code className="font-mono text-zinc-200">ACL SETUSER</code>, or <code className="font-mono text-zinc-200">AUTH</code>.
        </p>
      </div>
    );
  }

  // SQL Server Message
  if (connection.driver === 'mssql') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#191a20] p-6 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4 shadow-lg">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h3 className="text-base font-semibold text-zinc-100 mb-1">
          SQL Server User Management
        </h3>
        <p className="text-xs text-zinc-400 max-w-md leading-relaxed mb-4">
          SQL Server uses server logins and database users. You can manage logins, users, and roles directly in the Query Console using T-SQL commands such as <code className="font-mono text-zinc-200">CREATE LOGIN</code>, <code className="font-mono text-zinc-200">CREATE USER</code>, or <code className="font-mono text-zinc-200">ALTER ROLE</code>.
        </p>
      </div>
    );
  }

  // MongoDB Message
  if (connection.driver === 'mongodb') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#191a20] p-6 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4 shadow-lg">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h3 className="text-base font-semibold text-zinc-100 mb-1">
          MongoDB User Management
        </h3>
        <p className="text-xs text-zinc-400 max-w-md leading-relaxed mb-4">
          MongoDB uses role-based access control (RBAC). You can manage users, roles, and authentication directly in the Query Console using commands such as <code className="font-mono text-zinc-200">db.createUser(...)</code>, <code className="font-mono text-zinc-200">db.updateUser(...)</code>, or <code className="font-mono text-zinc-200">db.dropUser(...)</code>.
        </p>
      </div>
    );
  }

  // SQLite Message
  if (connection.driver === 'sqlite') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#191a20] p-6 text-center select-none">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-lg">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h3 className="text-base font-semibold text-zinc-100 mb-1">
          SQLite User Management
        </h3>
        <p className="text-xs text-zinc-400 max-w-md leading-relaxed mb-4">
          SQLite is a local, serverless database engine that does not maintain network user accounts or grant-based permissions. File permissions are handled directly by the operating system.
        </p>
        <span className="text-[11px] font-mono text-zinc-500 bg-[#14151a] px-3 py-1.5 rounded border border-[#272932]">
          File: {connection.filePath || connection.name}
        </span>
      </div>
    );
  }

  const connEnv = resolveConnectionEnv(connection);

  return (
    <div className="flex-1 flex flex-col bg-[#191a20] text-zinc-200 min-h-0 select-none">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#272932] bg-[#14151a]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
            <Users className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xs font-semibold text-white truncate">
              {connection.name}
            </h2>
            <span className="text-[10px] font-mono uppercase bg-[#22242c] text-zinc-400 px-1.5 py-0.5 rounded border border-[#2e313d]">
              {connection.driver}
            </span>
            {connEnv !== 'local' && (
              <span
                className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                  connEnv === 'prod'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}
              >
                {connEnv}
              </span>
            )}
            <span className="text-[11px] text-zinc-400 font-mono">
              • {users.length} {users.length === 1 ? 'user' : 'users'}
            </span>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#191a20] pl-8 pr-3 py-1 rounded text-xs text-zinc-200 placeholder-zinc-500 border border-[#272932] focus:border-blue-500 focus:outline-none w-48 sm:w-60 transition-all"
            />
          </div>

          <button
            type="button"
            onClick={loadUsers}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[#22242c] hover:bg-[#2c303c] text-zinc-300 border border-[#272932] transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Users"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold shadow transition-colors cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {/* Error Notice */}
      {errorMessage && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            onClick={loadUsers}
            className="text-rose-400 hover:underline font-medium ml-3 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Users Table */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        <div className="rounded-lg border border-[#272932] bg-[#14151a] overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#272932] bg-[#191a20] text-zinc-400 font-medium">
                <th className="py-2.5 px-3.5">User</th>
                {isMySQLLike(connection.driver) && <th className="py-2.5 px-3">Host</th>}
                <th className="py-2.5 px-3">Roles / Status</th>
                {isMySQLLike(connection.driver) && <th className="py-2.5 px-3">Plugin</th>}
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#23252f]">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-zinc-500">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto text-amber-400 mb-2" />
                    <span>Loading users from database...</span>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-zinc-500">
                    {searchQuery ? `No users matching "${searchQuery}"` : 'No users found'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent =
                    connection.username &&
                    u.username.toLowerCase() === connection.username.toLowerCase();

                  return (
                    <tr
                      key={`${u.username}@${u.host || 'pg'}`}
                      className="hover:bg-[#1d1f27] transition-colors group"
                    >
                      {/* Username Column */}
                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                            <User className="h-3 w-3" />
                          </div>
                          <span className="font-semibold text-zinc-100 font-mono">
                            {u.username}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 rounded">
                              Current
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Host Column (MySQL / MariaDB) */}
                      {isMySQLLike(connection.driver) && (
                        <td className="py-2.5 px-3 font-mono text-zinc-300">
                          {u.host === '%' ? (
                            <span className="text-zinc-400" title="Any Host">% (any host)</span>
                          ) : (
                            u.host
                          )}
                        </td>
                      )}

                      {/* Roles / Status Column */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {isMySQLLike(connection.driver) ? (
                            u.isLocked ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">
                                <Lock className="h-2.5 w-2.5" /> Locked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                                <Check className="h-2.5 w-2.5" /> Active
                              </span>
                            )
                          ) : (
                            <>
                              {u.isSuperuser && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold">
                                  SUPERUSER
                                </span>
                              )}
                              {u.canLogin && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300">
                                  LOGIN
                                </span>
                              )}
                              {u.canCreateDb && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                                  CREATEDB
                                </span>
                              )}
                              {u.canCreateRole && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300">
                                  CREATEROLE
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>

                      {/* Auth Plugin (MySQL / MariaDB) */}
                      {isMySQLLike(connection.driver) && (
                        <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-400">
                          {u.plugin || '-'}
                        </td>
                      )}

                      {/* Actions Column */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isMySQLLike(connection.driver) && (
                            <button
                              type="button"
                              onClick={() => handleToggleLockAccount(u)}
                              className={`p-1.5 rounded transition-colors cursor-pointer ${
                                u.isLocked
                                  ? 'text-amber-400 hover:text-white hover:bg-amber-600'
                                  : 'text-zinc-400 hover:text-white hover:bg-[#2d303b]'
                              }`}
                              title={u.isLocked ? 'Unlock Account' : 'Lock Account'}
                            >
                              {u.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenPermissionModal(u)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#22242c] hover:bg-[#2c303c] text-zinc-300 hover:text-white border border-[#2b2e3b] transition-colors cursor-pointer"
                            title="Edit Permissions & Roles"
                          >
                            <Shield className="h-3 w-3 text-amber-400" />
                            <span>Permissions</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenPasswordModal(u)}
                            className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#2d303b] transition-colors cursor-pointer"
                            title="Change Password"
                          >
                            <Key className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 rounded text-zinc-400 hover:text-rose-400 hover:bg-[#2d303b] transition-colors cursor-pointer"
                            title="Delete User"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CREATE NEW USER MODAL */}
      {/* ========================================================================= */}
      {createModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => !createModal.isExecuting && setCreateModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="w-full max-w-md bg-[#1e1f26] border border-[#2f3241] rounded-xl shadow-2xl flex flex-col text-xs text-zinc-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#282a36] bg-[#16171d]">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-amber-500/20 text-amber-400">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm text-white">Create New User</h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleConfirmCreateUser} className="p-4 space-y-3.5">
              {/* Username */}
              <div>
                <label className="block text-zinc-300 font-medium mb-1">
                  Username <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. app_user"
                  value={createModal.username}
                  onChange={(e) => setCreateModal((prev) => ({ ...prev, username: e.target.value }))}
                  required
                  autoFocus
                  className="w-full bg-[#131419] px-2.5 py-1.5 rounded text-xs text-zinc-100 border border-[#2c303c] focus:border-blue-500 focus:outline-none font-mono"
                />
              </div>

              {/* Host (MySQL / MariaDB) */}
              {isMySQLLike(connection.driver) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-zinc-300 font-medium">Host / Hostmask</label>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setCreateModal((prev) => ({ ...prev, host: '%' }))}
                        className={`px-1.5 py-0.2 rounded border ${
                          createModal.host === '%'
                            ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                            : 'border-zinc-700 hover:border-zinc-500 text-zinc-400'
                        }`}
                      >
                        % (Any)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreateModal((prev) => ({ ...prev, host: 'localhost' }))}
                        className={`px-1.5 py-0.2 rounded border ${
                          createModal.host === 'localhost'
                            ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                            : 'border-zinc-700 hover:border-zinc-500 text-zinc-400'
                        }`}
                      >
                        localhost
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={createModal.host}
                    onChange={(e) => setCreateModal((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder="%"
                    className="w-full bg-[#131419] px-2.5 py-1.5 rounded text-xs text-zinc-100 border border-[#2c303c] focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              )}

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-300 font-medium">Password</label>
                  <button
                    type="button"
                    onClick={() =>
                      setCreateModal((prev) => ({
                        ...prev,
                        password: generateSecurePassword(14),
                        showPassword: true,
                      }))
                    }
                    className="flex items-center gap-1 text-[10px] text-amber-400 hover:underline cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type={createModal.showPassword ? 'text' : 'password'}
                    placeholder="Enter password"
                    value={createModal.password}
                    onChange={(e) => setCreateModal((prev) => ({ ...prev, password: e.target.value }))}
                    className="w-full bg-[#131419] px-2.5 py-1.5 pr-8 rounded text-xs text-zinc-100 border border-[#2c303c] focus:border-blue-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setCreateModal((prev) => ({ ...prev, showPassword: !prev.showPassword }))}
                    className="absolute right-2 text-zinc-400 hover:text-white"
                  >
                    {createModal.showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* MySQL / MariaDB Privileges Presets */}
              {isMySQLLike(connection.driver) && (
                <div>
                  <label className="block text-zinc-300 font-medium mb-1">Privilege Preset</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectCreatePreset('readonly')}
                      className={`p-2 rounded border text-left cursor-pointer transition-colors ${
                        createModal.preset === 'readonly'
                          ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                          : 'border-[#2c303c] bg-[#14151a] hover:bg-[#252733] text-zinc-400'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">Read Only</div>
                      <div className="text-[10px] text-zinc-500">SELECT</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectCreatePreset('readwrite')}
                      className={`p-2 rounded border text-left cursor-pointer transition-colors ${
                        createModal.preset === 'readwrite'
                          ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                          : 'border-[#2c303c] bg-[#14151a] hover:bg-[#252733] text-zinc-400'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">Read & Write</div>
                      <div className="text-[10px] text-zinc-500">CRUD</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectCreatePreset('admin')}
                      className={`p-2 rounded border text-left cursor-pointer transition-colors ${
                        createModal.preset === 'admin'
                          ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                          : 'border-[#2c303c] bg-[#14151a] hover:bg-[#252733] text-zinc-400'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">All Privileges</div>
                      <div className="text-[10px] text-zinc-500">Full Admin</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Postgres Options */}
              {connection.driver === 'postgres' && (
                <div className="space-y-2 border border-[#2c303c] p-2.5 rounded bg-[#14151a]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createModal.pgCanLogin}
                      onChange={(e) => setCreateModal((prev) => ({ ...prev, pgCanLogin: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-zinc-200 font-medium">Can Login (LOGIN)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createModal.pgSuperuser}
                      onChange={(e) => setCreateModal((prev) => ({ ...prev, pgSuperuser: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-zinc-200 font-medium">Superuser (SUPERUSER)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createModal.pgCreateDb}
                      onChange={(e) => setCreateModal((prev) => ({ ...prev, pgCreateDb: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-zinc-200 font-medium">Create Database (CREATEDB)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createModal.pgCreateRole}
                      onChange={(e) => setCreateModal((prev) => ({ ...prev, pgCreateRole: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-zinc-200 font-medium">Create Roles (CREATEROLE)</span>
                  </label>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#282a36]">
                <button
                  type="button"
                  disabled={createModal.isExecuting}
                  onClick={() => setCreateModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3 py-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#282a36] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createModal.isExecuting || !createModal.username.trim()}
                  className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold shadow transition-colors cursor-pointer disabled:opacity-50"
                >
                  {createModal.isExecuting ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT PERMISSIONS MODAL */}
      {/* ========================================================================= */}
      {permissionModal.isOpen && permissionModal.user && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => !permissionModal.isExecuting && setPermissionModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="w-full max-w-xl bg-[#1e1f26] border border-[#2f3241] rounded-xl shadow-2xl flex flex-col text-xs text-zinc-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#282a36] bg-[#16171d]">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" />
                <h3 className="font-semibold text-sm text-white">
                  Permissions: <span className="font-mono text-amber-300">{permissionModal.user.username}</span>
                  {permissionModal.user.host && <span className="font-mono text-zinc-400">@{permissionModal.user.host}</span>}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPermissionModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleConfirmSavePermissions} className="p-4 space-y-4">
              {/* MySQL / MariaDB Section */}
              {isMySQLLike(connection.driver) ? (
                <>
                  {/* Database Scope */}
                  <div>
                    <label className="block text-zinc-300 font-medium mb-1">Database Scope</label>
                    <select
                      value={permissionModal.dbScope}
                      onChange={(e) => setPermissionModal((prev) => ({ ...prev, dbScope: e.target.value }))}
                      className="w-full bg-[#131419] px-2.5 py-1.5 rounded text-xs text-zinc-100 border border-[#2c303c] focus:outline-none"
                    >
                      <option value="*.*">*.* (All Databases & Tables)</option>
                      {availableDatabases.map((db) => (
                        <option key={db} value={db}>
                          {db}.* (Database: {db})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Object Privileges */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-zinc-300">Database Object Privileges</span>
                      <div className="flex items-center gap-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() =>
                            setPermissionModal((prev) => ({
                              ...prev,
                              selectedPrivileges: ['SELECT'],
                            }))
                          }
                          className="text-blue-400 hover:underline cursor-pointer"
                        >
                          Read Only
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPermissionModal((prev) => ({
                              ...prev,
                              selectedPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
                            }))
                          }
                          className="text-blue-400 hover:underline cursor-pointer"
                        >
                          Read & Write
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPermissionModal((prev) => ({
                              ...prev,
                              selectedPrivileges: ['ALL PRIVILEGES'],
                            }))
                          }
                          className="text-amber-400 hover:underline cursor-pointer"
                        >
                          All Privileges
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPermissionModal((prev) => ({
                              ...prev,
                              selectedPrivileges: [],
                            }))
                          }
                          className="text-zinc-400 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2.5 bg-[#14151a] rounded border border-[#282a36]">
                      {MYSQL_OBJECT_PRIVILEGES.map((priv) => {
                        const isChecked =
                          permissionModal.selectedPrivileges.includes('ALL PRIVILEGES') ||
                          permissionModal.selectedPrivileges.includes(priv);
                        return (
                          <label
                            key={priv}
                            className={`flex items-center gap-1.5 p-1 rounded cursor-pointer transition-colors ${
                              isChecked ? 'text-zinc-100 bg-blue-500/10' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleTogglePrivilege(priv)}
                              className="rounded"
                            />
                            <span className="truncate text-[11px] font-mono">{priv}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Administrative Privileges */}
                  <div>
                    <span className="font-semibold text-zinc-300 block mb-1.5">Administrative Privileges</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2.5 bg-[#14151a] rounded border border-[#282a36]">
                      {MYSQL_ADMIN_PRIVILEGES.map((priv) => {
                        const isChecked =
                          permissionModal.selectedPrivileges.includes('ALL PRIVILEGES') ||
                          permissionModal.selectedPrivileges.includes(priv);
                        return (
                          <label
                            key={priv}
                            className={`flex items-center gap-1.5 p-1 rounded cursor-pointer transition-colors ${
                              isChecked ? 'text-amber-200 bg-amber-500/10' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleTogglePrivilege(priv)}
                              className="rounded"
                            />
                            <span className="truncate text-[11px] font-mono">{priv}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Grant Option */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissionModal.withGrantOption}
                      onChange={(e) => setPermissionModal((prev) => ({ ...prev, withGrantOption: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-zinc-300">WITH GRANT OPTION (Allow user to grant permissions to others)</span>
                  </label>

                  {/* Existing Grants Output */}
                  {permissionModal.rawGrants.length > 0 && (
                    <div>
                      <span className="text-zinc-400 block mb-1 font-medium">Current Grants on Server:</span>
                      <pre className="p-2 bg-[#101115] rounded border border-[#22242c] font-mono text-[10px] text-zinc-400 overflow-x-auto max-h-24">
                        {permissionModal.rawGrants.join('\n')}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                /* PostgreSQL Section */
                <div className="space-y-3">
                  <div className="border border-[#2c303c] p-3 rounded-lg bg-[#14151a] space-y-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionModal.pgCanLogin}
                        onChange={(e) => setPermissionModal((prev) => ({ ...prev, pgCanLogin: e.target.checked }))}
                        className="rounded"
                      />
                      <div>
                        <span className="font-semibold text-zinc-200">Can Login (LOGIN)</span>
                        <p className="text-[10px] text-zinc-500">Allows role to connect to the database directly.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionModal.pgSuperuser}
                        onChange={(e) => setPermissionModal((prev) => ({ ...prev, pgSuperuser: e.target.checked }))}
                        className="rounded"
                      />
                      <div>
                        <span className="font-semibold text-rose-300">Superuser (SUPERUSER)</span>
                        <p className="text-[10px] text-zinc-500">Full administrative powers across the entire database cluster.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionModal.pgCreateDb}
                        onChange={(e) => setPermissionModal((prev) => ({ ...prev, pgCreateDb: e.target.checked }))}
                        className="rounded"
                      />
                      <div>
                        <span className="font-semibold text-zinc-200">Create Database (CREATEDB)</span>
                        <p className="text-[10px] text-zinc-500">Permits role to create new PostgreSQL databases.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionModal.pgCreateRole}
                        onChange={(e) => setPermissionModal((prev) => ({ ...prev, pgCreateRole: e.target.checked }))}
                        className="rounded"
                      />
                      <div>
                        <span className="font-semibold text-zinc-200">Create Roles (CREATEROLE)</span>
                        <p className="text-[10px] text-zinc-500">Permits role to create other users and roles.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#282a36]">
                <button
                  type="button"
                  disabled={permissionModal.isExecuting}
                  onClick={() => setPermissionModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3 py-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#282a36] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={permissionModal.isExecuting}
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow transition-colors cursor-pointer disabled:opacity-50"
                >
                  {permissionModal.isExecuting ? 'Applying...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CHANGE PASSWORD MODAL */}
      {/* ========================================================================= */}
      {passwordModal.isOpen && passwordModal.user && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => !passwordModal.isExecuting && setPasswordModal((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            className="w-full max-w-sm bg-[#1e1f26] border border-[#2f3241] rounded-xl shadow-2xl flex flex-col text-xs text-zinc-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#282a36] bg-[#16171d]">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-400" />
                <h3 className="font-semibold text-sm text-white">
                  Change Password: <span className="font-mono text-zinc-200">{passwordModal.user.username}</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleConfirmChangePassword} className="p-4 space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-300 font-medium">New Password</label>
                  <button
                    type="button"
                    onClick={() =>
                      setPasswordModal((prev) => ({
                        ...prev,
                        password: generateSecurePassword(14),
                        showPassword: true,
                      }))
                    }
                    className="flex items-center gap-1 text-[10px] text-amber-400 hover:underline cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type={passwordModal.showPassword ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={passwordModal.password}
                    onChange={(e) => setPasswordModal((prev) => ({ ...prev, password: e.target.value }))}
                    required
                    autoFocus
                    className="w-full bg-[#131419] px-2.5 py-1.5 pr-8 rounded text-xs text-zinc-100 border border-[#2c303c] focus:border-blue-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordModal((prev) => ({ ...prev, showPassword: !prev.showPassword }))}
                    className="absolute right-2 text-zinc-400 hover:text-white"
                  >
                    {passwordModal.showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#282a36]">
                <button
                  type="button"
                  disabled={passwordModal.isExecuting}
                  onClick={() => setPasswordModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3 py-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#282a36] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordModal.isExecuting || !passwordModal.password}
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow transition-colors cursor-pointer disabled:opacity-50"
                >
                  {passwordModal.isExecuting ? 'Saving...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
