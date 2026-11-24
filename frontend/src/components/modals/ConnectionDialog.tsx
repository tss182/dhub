import React, { useState, useEffect } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ConnectionService } from '../../../bindings/dhub/internal/services';
import { Dialogs } from '@wailsio/runtime';
import {
  X,
  CheckCircle,
  AlertCircle,
  Database,
  Trash2,
  FolderOpen,
  Shield,
  Key,
  Sliders,
  Terminal,
  Lock,
  Globe,
  FileKey,
  ChevronDown,
} from 'lucide-react';
import { alertError, confirmDialog } from '../../stores/useAlertStore';
import { ConnectionEnvType, resolveConnectionEnv } from '../../types/domain';
import { DbDriverIcon } from '../common/DbDriverIcon';
import { DriverPickerModal, getDriverOption, getDriverTagStyle, DriverType } from './DriverPickerModal';

type DialogTab = 'general' | 'ssh' | 'ssl' | 'advanced';

export const ConnectionDialog: React.FC = () => {
  const { isConnectionDialogOpen, setConnectionDialogOpen, editingConnectionId } = useWorkbenchStore();
  const {
    connections,
    setConnections,
    setActiveConnection,
    activeConnectionId,
    folders,
    connectionFolders,
    pendingFolderIdForNewConn,
    setPendingFolderIdForNewConn,
    moveConnectionToFolder,
  } = useConnectionStore();

  const [dialogTab, setDialogTab] = useState<DialogTab>('general');

  // General fields
  const [driver, setDriver] = useState<DriverType>('sqlite');
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [envType, setEnvType] = useState<ConnectionEnvType>('local');
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [filePath, setFilePath] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5432);
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [databaseName, setDatabaseName] = useState('postgres');
  const [colorTag, setColorTag] = useState('');

  // SSH Tunnel fields
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState('');
  const [sshAuthType, setSshAuthType] = useState<'key' | 'password' | 'agent'>('key');
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [sshPassword, setSshPassword] = useState('');

  // SSL/TLS fields
  const [sslMode, setSslMode] = useState('disable');
  const [sslCaPath, setSslCaPath] = useState('');
  const [sslCertPath, setSslCertPath] = useState('');
  const [sslKeyPath, setSslKeyPath] = useState('');

  // Advanced fields
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [txMode, setTxMode] = useState<'auto' | 'manual'>('auto');

  // MongoDB-specific options (persisted in optionsJson)
  const [mongoAuthSource, setMongoAuthSource] = useState('admin');
  const [mongoAuthMechanism, setMongoAuthMechanism] = useState('');
  const [mongoReplicaSet, setMongoReplicaSet] = useState('');
  const [mongoDirectConnection, setMongoDirectConnection] = useState(false);
  const [mongoReadPreference, setMongoReadPreference] = useState('primaryPreferred');
  const [pgExecMode, setPgExecMode] = useState<'cache_statement' | 'simple_protocol'>('cache_statement');

  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEnvTypeChange = (nextEnv: ConnectionEnvType) => {
    setEnvType(nextEnv);
    if (nextEnv === 'dev') {
      setColorTag('#10b981');
    } else if (nextEnv === 'prod') {
      setColorTag('#ef4444');
    } else {
      setColorTag('');
    }
  };

  useEffect(() => {
    if (!isConnectionDialogOpen) return;

    setDialogTab('general');
    if (editingConnectionId) {
      setFolderId(connectionFolders[editingConnectionId] || '');
      ConnectionService.GetConnection(editingConnectionId).then((conn) => {
        if (conn) {
          const resolvedEnv = resolveConnectionEnv(conn as any);
          setName(conn.name || '');
          setDriver((conn.driver as any) || 'sqlite');
          setEnvType(resolvedEnv);
          setHost(conn.host || 'localhost');
          setPort(conn.port || (conn.driver === 'mysql' || conn.driver === 'mariadb' ? 3306 : conn.driver === 'redis' ? 6379 : conn.driver === 'mssql' ? 1433 : conn.driver === 'mongodb' ? 27017 : conn.driver === 'clickhouse' ? 9000 : conn.driver === 'oracle' ? 1521 : conn.driver === 'qdrant' ? 6333 : conn.driver === 'elasticsearch' ? 9200 : 5432));
          setUsername(conn.username || '');
          setPassword(conn.password || '');
          setDatabaseName(conn.databaseName || '');
          setFilePath(conn.filePath || '');
          setColorTag(
            resolvedEnv === 'dev'
              ? '#10b981'
              : resolvedEnv === 'prod'
              ? '#ef4444'
              : ''
          );
          if (conn.folderId) {
            setFolderId(conn.folderId);
          }
          setIsReadOnly(Boolean(conn.isReadOnly));
          setTxMode((conn.txMode as any) || 'auto');
          setSshEnabled(Boolean(conn.sshEnabled));
          setSshHost(conn.sshHost || '');
          setSshPort(conn.sshPort || 22);
          setSshUser(conn.sshUser || '');
          setSshAuthType((conn.sshAuthType as any) || 'key');
          setSshKeyPath(conn.sshKeyPath || '');
          setSshPassword(conn.sshPassword || '');
          setSslMode(conn.sslMode || 'disable');
          setSslCaPath(conn.sslCaPath || '');
          setSslCertPath(conn.sslCertPath || '');
          setSslKeyPath(conn.sslKeyPath || '');
          try {
            const opts = conn.optionsJson ? JSON.parse(conn.optionsJson) : {};
            setMongoAuthSource(typeof opts.authSource === 'string' ? opts.authSource : 'admin');
            setMongoAuthMechanism(typeof opts.authMechanism === 'string' ? opts.authMechanism : '');
            setMongoReplicaSet(typeof opts.replicaSet === 'string' ? opts.replicaSet : '');
            setMongoDirectConnection(Boolean(opts.directConnection));
            setMongoReadPreference(typeof opts.readPreference === 'string' ? opts.readPreference : 'primaryPreferred');
          } catch {
            setMongoAuthSource('admin');
            setMongoAuthMechanism('');
            setMongoReplicaSet('');
            setMongoDirectConnection(false);
            setMongoReadPreference('primaryPreferred');
          }
        }
      }).catch((e) => {
        console.error('Failed to get connection for editing:', e);
        const existing = connections.find((c) => c.id === editingConnectionId);
        if (existing) {
          const resolvedEnv = resolveConnectionEnv(existing);
          setName(existing.name || '');
          setDriver((existing.driver as any) || 'sqlite');
          setEnvType(resolvedEnv);
          setHost(existing.host || 'localhost');
          setPort(existing.port || (existing.driver === 'mysql' || existing.driver === 'mariadb' ? 3306 : existing.driver === 'redis' ? 6379 : existing.driver === 'mssql' ? 1433 : existing.driver === 'mongodb' ? 27017 : existing.driver === 'clickhouse' ? 9000 : existing.driver === 'oracle' ? 1521 : existing.driver === 'qdrant' ? 6333 : existing.driver === 'elasticsearch' ? 9200 : 5432));
          setUsername(existing.username || '');
          setDatabaseName(existing.databaseName || '');
          setFilePath(existing.filePath || '');
          setIsReadOnly(Boolean(existing.isReadOnly));
          setTxMode((existing.txMode as any) || 'auto');
          setSshEnabled(Boolean(existing.sshEnabled));
          setSshHost(existing.sshHost || '');
          setSshPort(existing.sshPort || 22);
          setSshUser(existing.sshUser || '');
          setSshAuthType((existing.sshAuthType as any) || 'key');
          setSshKeyPath(existing.sshKeyPath || '');
          setSslMode(existing.sslMode || 'disable');
        }
      });
    } else {
      // Defaults for new connection
      setName('');
      setFolderId(pendingFolderIdForNewConn || '');
      setDriver('sqlite');
      setEnvType('local');
      setFilePath('');
      setHost('localhost');
      setPort(5432);
      setUsername('postgres');
      setPassword('');
      setDatabaseName('postgres');
      setColorTag('');
      setIsReadOnly(false);
      setTxMode('auto');
      setSshEnabled(false);
      setSshHost('');
      setSshPort(22);
      setSshUser('');
      setSshAuthType('key');
      setSshKeyPath('');
      setSshPassword('');
      setSslMode('disable');
      setSslCaPath('');
      setSslCertPath('');
      setSslKeyPath('');
      setMongoAuthSource('admin');
      setMongoAuthMechanism('');
      setMongoReplicaSet('');
      setMongoDirectConnection(false);
      setMongoReadPreference('primaryPreferred');
    }
    setTestResult(null);
  }, [isConnectionDialogOpen, editingConnectionId]);

  if (!isConnectionDialogOpen) return null;

  const handleDriverChange = (d: DriverType) => {
    setDriver(d);
    if (d === 'mysql' || d === 'mariadb') {
      setPort(3306);
      if (username === 'postgres' || username === 'sa') setUsername('root');
      if (databaseName === 'postgres' || databaseName === 'master') setDatabaseName('');
      if (sslMode === 'require' || sslMode === 'verify-full') {
        setSslMode('preferred');
      }
    } else if (d === 'postgres') {
      setPort(5432);
      if (!username || ['root', 'sa', 'admin', 'default', 'system', 'elastic', '__apikey__', '__bearer__'].includes(username)) {
        setUsername('postgres');
      }
      if (!databaseName || ['master', '0', 'default', 'admin', 'ORCL', 'main'].includes(databaseName)) {
        setDatabaseName('postgres');
      }
      if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslMode)) {
        setSslMode('disable');
      }
    } else if (d === 'mssql') {
      setPort(1433);
      if (username === 'postgres' || username === 'root') setUsername('sa');
      if (!databaseName || databaseName === 'postgres' || databaseName === '0') setDatabaseName('master');
      setSslMode('disable');
    } else if (d === 'mongodb') {
      setPort(27017);
      if (username === 'postgres' || username === 'root' || username === 'sa') setUsername('admin');
      if (!databaseName || databaseName === 'postgres' || databaseName === 'master' || databaseName === '0') setDatabaseName('admin');
      setSslMode('disable');
    } else if (d === 'redis') {
      setPort(6379);
      if (username === 'postgres' || username === 'root' || username === 'sa') setUsername('');
      if (databaseName === 'postgres' || databaseName === 'master' || !databaseName) setDatabaseName('0');
      setSslMode('disable');
    } else if (d === 'clickhouse') {
      setPort(9000);
      if (username === 'postgres' || username === 'root' || username === 'sa') setUsername('default');
      if (!databaseName || databaseName === 'postgres' || databaseName === 'master' || databaseName === '0' || databaseName === 'admin') setDatabaseName('default');
      setSslMode('disable');
    } else if (d === 'oracle') {
      setPort(1521);
      if (username === 'postgres' || username === 'root' || username === 'sa' || username === 'default') setUsername('system');
      if (!databaseName || databaseName === 'postgres' || databaseName === 'master' || databaseName === '0' || databaseName === 'admin' || databaseName === 'default') setDatabaseName('ORCL');
      setSslMode('disable');
    } else if (d === 'qdrant') {
      setPort(6333);
      setUsername('');
      setDatabaseName('default');
      setSslMode('disable');
    } else if (d === 'elasticsearch') {
      setPort(9200);
      if (!username || username === 'postgres' || username === 'root' || username === 'sa') {
        setUsername('elastic');
      }
      setDatabaseName('default');
      setSslMode('disable');
    }
  };

  const handleBrowseSqlite = async () => {
    try {
      const selected = await Dialogs.OpenFile({
        Title: 'Select SQLite Database File',
        Filters: [
          { DisplayName: 'SQLite Databases (*.db, *.sqlite, *.sqlite3)', Pattern: '*.db;*.sqlite;*.sqlite3;*.sqlite2;*' },
          { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
        ],
      });
      if (selected) {
        setFilePath(selected);
        if (!name) {
          const parts = selected.split(/[/\\\\]/);
          const base = parts[parts.length - 1]?.replace(/\.[^/.]+$/, '');
          if (base) setName(base);
        }
      }
    } catch (err) {
      console.error('File picker error:', err);
    }
  };

  const handleBrowseSshKey = async () => {
    try {
      const selected = await Dialogs.OpenFile({
        Title: 'Select SSH Private Key (id_rsa, id_ed25519, etc.)',
      });
      if (selected) {
        setSshKeyPath(selected);
      }
    } catch (err) {
      console.error('SSH key picker error:', err);
    }
  };

  const handleBrowseSslFile = async (setter: (p: string) => void, title: string) => {
    try {
      const selected = await Dialogs.OpenFile({
        Title: title,
        Filters: [
          { DisplayName: 'Certificate / Key Files (*.pem, *.crt, *.key)', Pattern: '*.pem;*.crt;*.key;*.cer;*' },
          { DisplayName: 'All Files (*.*)', Pattern: '*.*' },
        ],
      });
      if (selected) {
        setter(selected);
      }
    } catch (err) {
      console.error('SSL file picker error:', err);
    }
  };

  const buildConnectionPayload = () => {
    const existing = editingConnectionId
      ? connections.find((c) => c.id === editingConnectionId)
      : null;
    const sortOrder = existing?.sortOrder ?? connections.length;

    return {
      id: editingConnectionId || '',
      folderId: folderId || null,
      name: name || `${driver.toUpperCase()} Connection`,
      driver,
      envType,
      colorTag:
        envType === 'dev' ? '#10b981' : envType === 'prod' ? '#ef4444' : colorTag,
      isReadOnly,
      txMode,
      host,
      port: Number(port),
      username,
      password,
      databaseName,
      filePath,
      sslMode,
      sslCaPath,
      sslCertPath,
      sslKeyPath,
      sshEnabled,
      sshHost,
      sshPort: Number(sshPort),
      sshUser,
      sshAuthType,
      sshKeyPath,
      sshPassword,
      optionsJson:
        driver === 'mongodb'
          ? JSON.stringify({
              authSource: mongoAuthSource.trim() || 'admin',
              authMechanism: mongoAuthMechanism.trim(),
              replicaSet: mongoReplicaSet.trim(),
              directConnection: mongoDirectConnection,
              readPreference: mongoReadPreference,
            })
          : driver === 'postgres'
          ? JSON.stringify({
              ...(existing?.optionsJson ? (() => { try { return JSON.parse(existing.optionsJson); } catch { return {}; } })() : {}),
              defaultQueryExecMode: pgExecMode,
            })
          : existing?.optionsJson || '{}',
      sortOrder,
    };
  };

  const handleTest = async () => {
    setIsLoading(true);
    setTestResult(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = buildConnectionPayload();
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Connection test timed out after 12s')), 12000);
      });
      const res = await Promise.race([
        ConnectionService.TestConnection(payload as any),
        timeoutPromise,
      ]);
      setTestResult({ success: true, message: res });
    } catch (e: any) {
      setTestResult({ success: false, message: e?.message || String(e) });
    } finally {
      if (timer) clearTimeout(timer);
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const payload = buildConnectionPayload();
      const id = await ConnectionService.SaveConnection(payload as any);

      const updated = await ConnectionService.ListConnections();
      setConnections(updated as any);
      moveConnectionToFolder(id, folderId || null);
      setPendingFolderIdForNewConn(null);
      const defaultDb =
        driver === 'postgres'
          ? 'postgres'
          : driver === 'qdrant' || driver === 'elasticsearch'
          ? 'default'
          : driver === 'mssql'
          ? 'master'
          : driver === 'mongodb'
          ? 'admin'
          : 'main';
      const defaultSchema = driver === 'postgres' ? 'public' : driver === 'mssql' ? 'dbo' : defaultDb;
      setActiveConnection(id, databaseName || defaultDb, defaultSchema);
      setConnectionDialogOpen(false);
    } catch (e: any) {
      alertError(e?.message || String(e), 'Failed to Save Connection');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editingConnectionId) return;
    const okDel = await confirmDialog({
      title: 'Delete Connection',
      message: `Are you sure you want to delete connection "${name}"?`,
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!okDel) return;

    setIsLoading(true);
    try {
      await ConnectionService.DeleteConnection(editingConnectionId);
      const updated = await ConnectionService.ListConnections();
      setConnections(updated as any);
      if (activeConnectionId === editingConnectionId) {
        if (updated && updated.length > 0) {
          const nextConn = updated[0];
          const nextDb =
            nextConn.driver === 'postgres'
              ? 'postgres'
              : nextConn.driver === 'qdrant' || nextConn.driver === 'elasticsearch'
              ? 'default'
              : nextConn.driver === 'mssql'
              ? 'master'
              : nextConn.driver === 'mongodb'
              ? 'admin'
              : 'main';
          const nextSchema = nextConn.driver === 'postgres' ? 'public' : nextConn.driver === 'mssql' ? 'dbo' : nextDb;
          setActiveConnection(nextConn.id, nextConn.databaseName || nextDb, nextSchema);
        } else {
          setActiveConnection('', '', '');
        }
      }
      setConnectionDialogOpen(false);
    } catch (e: any) {
      alertError(e?.message || String(e), 'Failed to Delete Connection');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div
        className={`flex w-[600px] max-h-[90vh] flex-col rounded-lg bg-[#191a20] border shadow-2xl text-xs text-zinc-300 overflow-hidden transition-colors ${
          envType === 'dev'
            ? 'border-emerald-700/60'
            : envType === 'prod'
            ? 'border-rose-700/60'
            : 'border-[#272932]'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`flex h-11 items-center justify-between border-b px-4 transition-colors shrink-0 ${
            envType === 'dev'
              ? 'bg-emerald-950/70 border-emerald-800/60'
              : envType === 'prod'
              ? 'bg-rose-950/70 border-rose-800/60'
              : 'bg-[#14151a] border-[#272932]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Database
              className={`h-4 w-4 ${
                envType === 'dev'
                  ? 'text-emerald-400'
                  : envType === 'prod'
                  ? 'text-rose-400'
                  : 'text-blue-400'
              }`}
            />
            <span className="font-semibold text-sm text-zinc-100">
              {editingConnectionId ? `Edit Connection: ${name || 'Database'}` : 'New Database Connection'}
            </span>
            {envType !== 'local' && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono border ${
                  envType === 'dev'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                {envType === 'dev' ? 'DEV' : 'PROD'}
              </span>
            )}
            {isReadOnly && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                READ-ONLY
              </span>
            )}
          </div>
          <button
            onClick={() => setConnectionDialogOpen(false)}
            className="rounded p-1 text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation Header */}
        <div className="flex items-center gap-1 border-b border-[#272932] px-4 bg-[#14151a] shrink-0">
          <button
            type="button"
            onClick={() => setDialogTab('general')}
            className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium cursor-pointer transition-colors ${
              dialogTab === 'general'
                ? 'border-blue-500 text-white font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>General</span>
          </button>

          {driver !== 'sqlite' && (
            <>
              <button
                type="button"
                onClick={() => setDialogTab('ssh')}
                className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium cursor-pointer transition-colors ${
                  dialogTab === 'ssh'
                    ? 'border-blue-500 text-white font-semibold'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>SSH Tunnel</span>
                {sshEnabled && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setDialogTab('ssl')}
                className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium cursor-pointer transition-colors ${
                  dialogTab === 'ssl'
                    ? 'border-blue-500 text-white font-semibold'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                <span>SSL / TLS</span>
                {sslMode !== 'disable' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-0.5" />
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setDialogTab('advanced')}
            className={`flex items-center gap-1.5 py-2.5 px-3 border-b-2 font-medium cursor-pointer transition-colors ${
              dialogTab === 'advanced'
                ? 'border-blue-500 text-white font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Advanced</span>
            {isReadOnly && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 ml-0.5" />
            )}
          </button>
        </div>

        {/* Modal Body / Tab Contents */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* TAB 1: GENERAL */}
          {dialogTab === 'general' && (
            <div className="space-y-4">
              {/* Driver Selector Combobox */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5 font-semibold">
                  Driver
                </label>
                <button
                  type="button"
                  onClick={() => setIsDriverModalOpen(true)}
                  className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-lg border border-[#272932] bg-[#14151a] hover:bg-[#1c1d25] hover:border-zinc-500 transition-all text-left cursor-pointer group shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-[#21232d] border border-[#2f3342] flex items-center justify-center shrink-0 group-hover:border-blue-500/60 transition-colors">
                      <DbDriverIcon driver={driver} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-zinc-100 truncate">
                          {getDriverOption(driver).name}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-medium uppercase px-1.5 py-0.5 rounded border shrink-0 ${getDriverTagStyle(
                            getDriverOption(driver).tag
                          )}`}
                        >
                          {getDriverOption(driver).tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {getDriverOption(driver).description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 ml-3 px-2.5 py-1.5 rounded-md bg-[#21232d] border border-[#2e313e] text-zinc-300 group-hover:border-blue-500/40 group-hover:text-blue-300 transition-colors shrink-0">
                    <span className="text-[11px] font-medium">Select</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </div>
                </button>
              </div>

              {/* Connection Type / Environment Selector */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1 font-semibold">
                  Environment Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleEnvTypeChange('local')}
                    className={`flex items-center justify-center gap-2 rounded border py-2 px-3 font-medium cursor-pointer transition-all ${
                      envType === 'local'
                        ? 'border-zinc-500 bg-[#232631] text-zinc-100 shadow-xs'
                        : 'border-[#272932] bg-[#14151a] text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    <span>Local (Default)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEnvTypeChange('dev')}
                    className={`flex items-center justify-center gap-2 rounded border py-2 px-3 font-medium cursor-pointer transition-all ${
                      envType === 'dev'
                        ? 'border-emerald-500 bg-emerald-600/25 text-emerald-200 shadow-xs'
                        : 'border-[#272932] bg-[#14151a] text-zinc-400 hover:border-emerald-700/60'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>Development</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEnvTypeChange('prod')}
                    className={`flex items-center justify-center gap-2 rounded border py-2 px-3 font-medium cursor-pointer transition-all ${
                      envType === 'prod'
                        ? 'border-rose-500 bg-rose-600/25 text-rose-200 shadow-xs'
                        : 'border-[#272932] bg-[#14151a] text-zinc-400 hover:border-rose-700/60'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
                    <span>Production</span>
                  </button>
                </div>
              </div>

              {/* Connection Name & Folder */}
              <div className={folders.length > 0 ? 'grid grid-cols-3 gap-2' : ''}>
                <div className={folders.length > 0 ? 'col-span-2' : ''}>
                  <label className="block text-[11px] text-zinc-400 mb-1">Display Name</label>
                  <input
                    type="text"
                    placeholder={`e.g. Local ${driver.toUpperCase()}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {folders.length > 0 && (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Folder / Group</label>
                    <select
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                      className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">None (Ungrouped)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Specific Inputs based on Driver */}
              {driver === 'sqlite' ? (
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Database File Path</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="/path/to/database.db"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      className="flex-1 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseSqlite}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#22242c] hover:bg-[#2e313d] border border-[#3b3e4f] text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 font-medium"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-blue-400" />
                      <span>Browse...</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-[11px] text-zinc-400 mb-1">
                        {driver === 'qdrant'
                          ? 'Host / Qdrant URL'
                          : driver === 'elasticsearch'
                          ? 'Host / Elasticsearch URL / Cloud ID'
                          : 'Host'}
                      </label>
                      <input
                        type="text"
                        placeholder={
                          driver === 'qdrant'
                            ? 'localhost or https://xxx.cloud.qdrant.io:6333'
                            : driver === 'elasticsearch'
                            ? 'localhost, https://xxx.es.cloud.es.io:9200, or cluster:dXMt...'
                            : undefined
                        }
                        value={host}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHost(val);
                          if (
                            (driver === 'qdrant' || driver === 'elasticsearch') &&
                            (val.startsWith('https://') || val.startsWith('http://'))
                          ) {
                            try {
                              const parsed = new URL(val.trim());
                              if (parsed.port) {
                                setPort(Number(parsed.port));
                              } else if (parsed.protocol === 'https:') {
                                setPort(443);
                              } else if (parsed.protocol === 'http:') {
                                setPort(driver === 'elasticsearch' ? 9200 : 6333);
                              }
                              if (parsed.protocol === 'https:' && sslMode === 'disable') {
                                setSslMode('verify-full');
                              } else if (parsed.protocol === 'http:' && sslMode !== 'disable') {
                                setSslMode('disable');
                              }
                            } catch {}
                          } else if (
                            driver === 'elasticsearch' &&
                            val.includes(':') &&
                            !val.includes('://')
                          ) {
                            // Detect Elastic Cloud ID (<name>:<base64(domain$es_uuid$...)>)
                            const colonIdx = val.indexOf(':');
                            const b64 = val.slice(colonIdx + 1).trim();
                            if (b64.length > 16) {
                              try {
                                const decoded = atob(b64);
                                const parts = decoded.split('$');
                                if (parts.length >= 2 && parts[0].includes('.')) {
                                  setPort(443);
                                  if (sslMode === 'disable') setSslMode('verify-full');
                                }
                              } catch {}
                            }
                          } else if (
                            (driver === 'qdrant' || driver === 'elasticsearch') &&
                            !val.includes('://') &&
                            sslMode === 'verify-full'
                          ) {
                            setSslMode('disable');
                          }
                        }}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Port</label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  {driver === 'qdrant' ? (
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">
                        API Key <span className="text-zinc-500 text-[10px] lowercase">(optional)</span>
                      </label>
                      <input
                        type="password"
                        placeholder="Optional Qdrant API Key"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  ) : driver === 'elasticsearch' ? (
                    (() => {
                      const esAuthMode =
                        username === '__apikey__'
                          ? 'apikey'
                          : username === '__bearer__'
                          ? 'bearer'
                          : !username && !password
                          ? 'none'
                          : 'basic';
                      return (
                        <div className="space-y-2.5">
                          <div>
                            <label className="block text-[11px] text-zinc-400 mb-1">
                              Authentication Mode
                            </label>
                            <div className="grid grid-cols-4 gap-1.5">
                              {(
                                [
                                  { id: 'basic', label: 'Basic Auth' },
                                  { id: 'apikey', label: 'API Key' },
                                  { id: 'bearer', label: 'Bearer Token' },
                                  { id: 'none', label: 'No Auth' },
                                ] as const
                              ).map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    if (m.id === 'basic') {
                                      setUsername(username.startsWith('__') || !username ? 'elastic' : username);
                                    } else if (m.id === 'apikey') {
                                      setUsername('__apikey__');
                                    } else if (m.id === 'bearer') {
                                      setUsername('__bearer__');
                                    } else {
                                      setUsername('');
                                      setPassword('');
                                    }
                                  }}
                                  className={`py-1.5 px-2 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                                    esAuthMode === m.id
                                      ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                                      : 'border-[#272932] bg-[#121317] text-zinc-400 hover:border-zinc-600'
                                  }`}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {esAuthMode === 'basic' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] text-zinc-400 mb-1">Username</label>
                                <input
                                  type="text"
                                  placeholder="elastic"
                                  value={username.startsWith('__') ? '' : username}
                                  onChange={(e) => setUsername(e.target.value)}
                                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-zinc-400 mb-1">Password</label>
                                <input
                                  type="password"
                                  placeholder="••••••••"
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}

                          {esAuthMode === 'apikey' && (
                            <div>
                              <label className="block text-[11px] text-zinc-400 mb-1">
                                Encoded API Key or <code className="text-zinc-300">id:api_key</code>
                              </label>
                              <input
                                type="password"
                                placeholder="Base64 encoded key or key_id:secret_key"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                              />
                            </div>
                          )}

                          {esAuthMode === 'bearer' && (
                            <div>
                              <label className="block text-[11px] text-zinc-400 mb-1">
                                Bearer / Service Account Token
                              </label>
                              <input
                                type="password"
                                placeholder="AAEAAWVsYXN0aWM..."
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            User {driver === 'redis' && <span className="text-zinc-500 text-[10px] lowercase">(optional)</span>}
                          </label>
                          <input
                            type="text"
                            placeholder={driver === 'redis' ? 'default (optional)' : driver === 'postgres' ? 'e.g. postgres' : 'e.g. root'}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            Password{' '}
                            {driver === 'redis' && <span className="text-zinc-500 text-[10px] lowercase">(AUTH)</span>}
                          </label>
                          <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          {driver === 'redis' ? 'Database Index' : driver === 'oracle' ? 'Service Name' : 'Database Name'}{' '}
                          {(driver === 'mysql' || driver === 'mariadb') && (
                            <span className="text-zinc-500 text-[10px] lowercase">(leave empty to show all databases)</span>
                          )}
                          {driver === 'redis' && (
                            <span className="text-zinc-500 text-[10px] lowercase">(0-15, default 0)</span>
                          )}
                        </label>
                        <input
                          type="text"
                          placeholder={
                            driver === 'mysql' || driver === 'mariadb'
                              ? 'Optional (leave empty to list all databases)'
                              : driver === 'redis'
                              ? '0'
                              : driver === 'mssql'
                              ? 'master'
                              : driver === 'mongodb'
                              ? 'admin'
                              : driver === 'clickhouse'
                              ? 'default'
                              : driver === 'oracle'
                              ? 'e.g. ORCL or FREEPDB1'
                              : 'e.g. postgres'
                          }
                          value={databaseName}
                          onChange={(e) => setDatabaseName(e.target.value)}
                          className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                        />
                      </div>

                      {driver === 'postgres' && (
                        <div className="space-y-2 pt-2 border-t border-[#232530]">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-zinc-400">Cloud / PgBouncer Presets</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={pgExecMode === 'simple_protocol'}
                                onChange={(e) => setPgExecMode(e.target.checked ? 'simple_protocol' : 'cache_statement')}
                                className="h-3.5 w-3.5 rounded border-[#3b3e4f] bg-[#22242c] text-blue-600 focus:ring-0 cursor-pointer"
                              />
                              <span>Simple Protocol (PgBouncer Transaction Pool)</span>
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: 'Supabase Pooler', port: '6543', ssl: 'require', mode: 'simple_protocol' as const, db: 'postgres' },
                              { label: 'Neon', port: '5432', ssl: 'require', mode: 'cache_statement' as const, db: 'neondb' },
                              { label: 'AWS RDS', port: '5432', ssl: 'require', mode: 'cache_statement' as const, db: 'postgres' },
                              { label: 'Cloud SQL', port: '5432', ssl: 'require', mode: 'cache_statement' as const, db: 'postgres' },
                              { label: 'DigitalOcean', port: '25060', ssl: 'require', mode: 'simple_protocol' as const, db: 'defaultdb' },
                            ].map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => {
                                  setPort(Number(p.port));
                                  setSslMode(p.ssl);
                                  setPgExecMode(p.mode);
                                  if (!databaseName.trim() || databaseName === 'postgres') setDatabaseName(p.db);
                                }}
                                className="px-2 py-1 rounded bg-[#1a1c24] hover:bg-[#252834] border border-[#2d303d] text-[10px] text-cyan-300 font-medium cursor-pointer transition-colors"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {driver === 'mongodb' && (
                        <div className="space-y-2.5 pt-1 border-t border-[#232530]">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-zinc-400 mb-1">
                                Auth Source <span className="text-zinc-500 text-[10px]">(e.g. admin)</span>
                              </label>
                              <input
                                type="text"
                                placeholder="admin"
                                value={mongoAuthSource}
                                onChange={(e) => setMongoAuthSource(e.target.value)}
                                className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-zinc-400 mb-1">Auth Mechanism</label>
                              <select
                                value={mongoAuthMechanism}
                                onChange={(e) => setMongoAuthMechanism(e.target.value)}
                                className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                              >
                                <option value="">DEFAULT (Auto)</option>
                                <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                                <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
                                <option value="MONGODB-X509">MONGODB-X509</option>
                                <option value="PLAIN">PLAIN (LDAP)</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 items-center">
                            <div>
                              <label className="block text-[11px] text-zinc-400 mb-1">
                                Replica Set <span className="text-zinc-500 text-[10px]">(optional)</span>
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. rs0"
                                value={mongoReplicaSet}
                                onChange={(e) => setMongoReplicaSet(e.target.value)}
                                className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                              />
                            </div>
                            <div className="pt-4">
                              <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={mongoDirectConnection}
                                  onChange={(e) => setMongoDirectConnection(e.target.checked)}
                                  className="h-3.5 w-3.5 rounded border-[#3b3e4f] bg-[#22242c] text-blue-600 focus:ring-0 cursor-pointer"
                                />
                                <span>Direct Connection</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SSH TUNNEL */}
          {dialogTab === 'ssh' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded bg-[#14151a] border border-[#272932]">
                <div>
                  <div className="font-medium text-zinc-200 text-xs">Use SSH Tunnel</div>
                  <div className="text-[11px] text-zinc-500">
                    Route connection traffic securely through an intermediate bastion server
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={sshEnabled}
                  onChange={(e) => setSshEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#3b3e4f] bg-[#22242c] text-blue-600 focus:ring-0 cursor-pointer"
                />
              </div>

              {sshEnabled && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-[11px] text-zinc-400 mb-1">SSH Host</label>
                      <input
                        type="text"
                        placeholder="bastion.example.com"
                        value={sshHost}
                        onChange={(e) => setSshHost(e.target.value)}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">SSH Port</label>
                      <input
                        type="number"
                        value={sshPort}
                        onChange={(e) => setSshPort(Number(e.target.value))}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">SSH Username</label>
                      <input
                        type="text"
                        placeholder="e.g. ubuntu"
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Authentication Method</label>
                      <select
                        value={sshAuthType}
                        onChange={(e) => setSshAuthType(e.target.value as any)}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="key">Private Key (Recommended)</option>
                        <option value="password">Password</option>
                        <option value="agent">SSH Agent (SSH_AUTH_SOCK)</option>
                      </select>
                    </div>
                  </div>

                  {sshAuthType === 'key' ? (
                    <div>
                      <div className="mb-2">
                        <label className="block text-[11px] text-zinc-400 mb-1">Private Key File Path</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="~/.ssh/id_rsa or /home/.../key.pem"
                            value={sshKeyPath}
                            onChange={(e) => setSshKeyPath(e.target.value)}
                            className="flex-1 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleBrowseSshKey}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#22242c] hover:bg-[#2e313d] border border-[#3b3e4f] text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 font-medium"
                          >
                            <FileKey className="h-3.5 w-3.5 text-amber-400" />
                            <span>Browse...</span>
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Key Passphrase (optional)</label>
                        <input
                          type="password"
                          placeholder="Leave blank if key has no passphrase"
                          value={sshPassword}
                          onChange={(e) => setSshPassword(e.target.value)}
                          className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : sshAuthType === 'agent' ? (
                    <div className="p-2.5 rounded bg-[#121317] border border-[#272932] text-[11px] text-zinc-400">
                      Uses keys loaded in your local SSH agent via <code className="text-zinc-300 font-mono">SSH_AUTH_SOCK</code>.
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">SSH Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={sshPassword}
                        onChange={(e) => setSshPassword(e.target.value)}
                        className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SSL / TLS */}
          {dialogTab === 'ssl' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1 font-semibold uppercase tracking-wider">
                  SSL / TLS Mode
                </label>
                <select
                  value={sslMode}
                  onChange={(e) => setSslMode(e.target.value)}
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-2 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                >
                  <option value="disable">disable (No encryption)</option>
                  {driver === 'postgres' ? (
                    <>
                      <option value="allow">allow (Try non-SSL, fallback to SSL)</option>
                      <option value="prefer">prefer (Try SSL, fallback to non-SSL)</option>
                      <option value="require">require (Encrypt without CA verification)</option>
                      <option value="verify-ca">verify-ca (Verify server CA)</option>
                      <option value="verify-full">verify-full (Verify server CA & hostname)</option>
                    </>
                  ) : driver === 'qdrant' || driver === 'elasticsearch' || driver === 'mongodb' ? (
                    <>
                      <option value="require">require (Encrypt without CA verification)</option>
                      <option value="verify-ca">verify-ca (Verify server CA)</option>
                      <option value="verify-full">verify-full (Verify server CA & hostname)</option>
                    </>
                  ) : (
                    <>
                      <option value="preferred">preferred (Encrypt if supported by server)</option>
                      <option value="required">required (Require encrypted connection)</option>
                      <option value="verify-ca">verify-ca (Verify CA)</option>
                      <option value="verify-identity">verify-identity (Verify CA & identity)</option>
                    </>
                  )}
                </select>
              </div>

              {sslMode !== 'disable' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      {driver === 'elasticsearch'
                        ? 'CA Certificate File Path or SHA-256 Fingerprint (Optional)'
                        : 'CA Certificate (Optional)'}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={
                          driver === 'elasticsearch'
                            ? '/path/to/http_ca.crt or 64-char SHA-256 hex fingerprint'
                            : '/path/to/server-ca.pem'
                        }
                        value={sslCaPath}
                        onChange={(e) => setSslCaPath(e.target.value)}
                        className="flex-1 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleBrowseSslFile(setSslCaPath, 'Select CA Certificate')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#22242c] hover:bg-[#2e313d] border border-[#3b3e4f] text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 font-medium"
                      >
                        <Shield className="h-3.5 w-3.5 text-blue-400" />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Client Certificate (Optional)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="/path/to/client-cert.pem"
                        value={sslCertPath}
                        onChange={(e) => setSslCertPath(e.target.value)}
                        className="flex-1 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleBrowseSslFile(setSslCertPath, 'Select Client Certificate')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#22242c] hover:bg-[#2e313d] border border-[#3b3e4f] text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 font-medium"
                      >
                        <Shield className="h-3.5 w-3.5 text-teal-400" />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Client Key (Optional)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="/path/to/client-key.pem"
                        value={sslKeyPath}
                        onChange={(e) => setSslKeyPath(e.target.value)}
                        className="flex-1 rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleBrowseSslFile(setSslKeyPath, 'Select Client Key')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#22242c] hover:bg-[#2e313d] border border-[#3b3e4f] text-zinc-200 hover:text-white transition-colors cursor-pointer shrink-0 font-medium"
                      >
                        <Key className="h-3.5 w-3.5 text-amber-400" />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ADVANCED */}
          {dialogTab === 'advanced' && (
            <div className="space-y-4">
              {/* Read Only Toggle */}
              <div className="flex items-start justify-between p-3 rounded bg-[#14151a] border border-[#272932] gap-3">
                <div>
                  <div className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
                    <span>Read-Only Connection</span>
                    {isReadOnly && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1 py-0.2 rounded font-mono font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Blocks all data modification statements (INSERT, UPDATE, DELETE, TRUNCATE) and DDL changes (DROP, ALTER, CREATE). Ideal for production environments.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isReadOnly}
                  onChange={(e) => setIsReadOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-[#3b3e4f] bg-[#22242c] text-amber-500 focus:ring-0 cursor-pointer mt-0.5"
                />
              </div>

              {/* Transaction Mode (not applicable to Qdrant / Elasticsearch / MongoDB) */}
              {driver === 'qdrant' || driver === 'elasticsearch' || driver === 'mongodb' ? (
                <div className="p-3 rounded bg-[#14151a] border border-[#272932] space-y-2.5 text-[11px] text-zinc-400">
                  <div className="font-semibold text-zinc-200 text-xs mb-0.5">Execution Mode</div>
                  {driver === 'elasticsearch' ? (
                    <p>Elasticsearch executes REST, Bulk, and search operations immediately (Auto-Commit). Multi-statement SQL transactions are not used by Elasticsearch.</p>
                  ) : driver === 'mongodb' ? (
                    <>
                      <p>MongoDB operations execute immediately (Auto-Commit). Choose default Read Preference for queries:</p>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Read Preference</label>
                        <select
                          value={mongoReadPreference}
                          onChange={(e) => setMongoReadPreference(e.target.value)}
                          className="w-full rounded bg-[#121317] border border-[#272932] px-2.5 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                        >
                          <option value="primaryPreferred">primaryPreferred (Recommended)</option>
                          <option value="primary">primary</option>
                          <option value="secondaryPreferred">secondaryPreferred</option>
                          <option value="secondary">secondary</option>
                          <option value="nearest">nearest</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <p>Qdrant executes REST and vector operations immediately (Auto-Commit). Multi-statement transactions are not used by Qdrant.</p>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded bg-[#14151a] border border-[#272932] space-y-2">
                  <div>
                    <div className="font-semibold text-zinc-200 text-xs">Transaction Mode</div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      Choose whether statements are committed automatically or staged inside explicit transactions.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setTxMode('auto')}
                      className={`flex items-center justify-center gap-2 rounded border py-2 px-3 font-medium cursor-pointer transition-colors ${
                        txMode === 'auto'
                          ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                          : 'border-[#272932] bg-[#191a20] text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      <span>Auto-Commit (Default)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxMode('manual')}
                      className={`flex items-center justify-center gap-2 rounded border py-2 px-3 font-medium cursor-pointer transition-colors ${
                        txMode === 'manual'
                          ? 'border-amber-500 bg-amber-600/20 text-amber-200'
                          : 'border-[#272932] bg-[#191a20] text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      <span>Manual Commit / Rollback</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Test Status Banner */}
          {testResult && (
            <div
              className={`flex items-center justify-between gap-2 p-2.5 rounded border text-[11px] ${
                testResult.success
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                )}
                <span className="truncate">{testResult.message}</span>
              </div>
              {!testResult.success && testResult.message.includes('has CHANGED') && sshEnabled && (
                <button
                  type="button"
                  onClick={async () => {
                    const confirmed = await confirmDialog({
                      title: 'SSH Host Key Changed',
                      message: `Reset stored SSH host key for ${sshHost}:${sshPort || 22}? Only do this if you trust the new server key.`,
                      confirmLabel: 'Reset & Trust',
                      isDanger: true,
                    });
                    if (!confirmed) return;
                    try {
                      await (ConnectionService as any).ResetSSHHostKey(sshHost, sshPort || 22);
                      setTestResult(null);
                      handleTest();
                    } catch (err: any) {
                      alertError(err?.message || 'Failed to reset SSH host key');
                    }
                  }}
                  className="shrink-0 px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-medium cursor-pointer"
                >
                  Reset & Trust Key
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex h-12 items-center justify-between border-t border-[#272932] px-4 bg-[#14151a] shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={isLoading}
              className="rounded border border-[#272932] hover:bg-[#22242c] px-3 py-1.5 text-zinc-300 font-medium transition-colors cursor-pointer"
            >
              {isLoading ? 'Testing...' : 'Test Connection'}
            </button>
            {editingConnectionId && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isLoading}
                className="flex items-center gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded px-2.5 py-1.5 text-xs transition-colors cursor-pointer"
                title="Delete Connection"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConnectionDialogOpen(false)}
              className="rounded px-3 py-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-white font-medium transition-colors cursor-pointer shadow-sm"
            >
              {editingConnectionId ? 'Save Changes' : 'Save & Connect'}
            </button>
          </div>
        </div>
      </div>

      <DriverPickerModal
        isOpen={isDriverModalOpen}
        onClose={() => setIsDriverModalOpen(false)}
        selectedDriver={driver}
        onSelectDriver={(d) => handleDriverChange(d)}
      />
    </div>
  );
};
