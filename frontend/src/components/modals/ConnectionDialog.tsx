import React, { useState, useEffect } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ConnectionService } from '../../../bindings/dhub/internal/services';
import { X, CheckCircle, AlertCircle, Database, Trash2 } from 'lucide-react';
import { alertError, confirmDialog } from '../../stores/useAlertStore';
import { ConnectionEnvType, resolveConnectionEnv } from '../../types/domain';
import { DbDriverIcon } from '../common/DbDriverIcon';

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

  const [driver, setDriver] = useState<'sqlite' | 'postgres' | 'mysql'>('sqlite');
  const [envType, setEnvType] = useState<ConnectionEnvType>('local');
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [filePath, setFilePath] = useState('/home/tss/.gemini/antigravity/dhub_demo.db');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5432);
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [databaseName, setDatabaseName] = useState('postgres');
  const [colorTag, setColorTag] = useState('');

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

    if (editingConnectionId) {
      setFolderId(connectionFolders[editingConnectionId] || '');
      // Fetch full connection data from backend (including keyring password)
      ConnectionService.GetConnection(editingConnectionId).then((conn) => {
        if (conn) {
          const resolvedEnv = resolveConnectionEnv(conn as any);
          setName(conn.name || '');
          setDriver((conn.driver as any) || 'sqlite');
          setEnvType(resolvedEnv);
          setHost(conn.host || 'localhost');
          setPort(conn.port || (conn.driver === 'mysql' ? 3306 : 5432));
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
        }
      }).catch((e) => {
        console.error('Failed to get connection for editing:', e);
        // Fallback to in-memory store
        const existing = connections.find((c) => c.id === editingConnectionId);
        if (existing) {
          const resolvedEnv = resolveConnectionEnv(existing);
          setName(existing.name || '');
          setDriver((existing.driver as any) || 'sqlite');
          setEnvType(resolvedEnv);
          setHost(existing.host || 'localhost');
          setPort(existing.port || 5432);
          setUsername(existing.username || '');
          setDatabaseName(existing.databaseName || '');
          setFilePath(existing.filePath || '');
          setColorTag(
            resolvedEnv === 'dev'
              ? '#10b981'
              : resolvedEnv === 'prod'
              ? '#ef4444'
              : ''
          );
        }
      });
    } else {
      // Defaults for new connection
      setName('');
      setFolderId(pendingFolderIdForNewConn || '');
      setDriver('sqlite');
      setEnvType('local');
      setFilePath('/home/tss/.gemini/antigravity/dhub_demo.db');
      setHost('localhost');
      setPort(5432);
      setUsername('postgres');
      setPassword('');
      setDatabaseName('postgres');
      setColorTag('');
    }
    setTestResult(null);
  }, [isConnectionDialogOpen, editingConnectionId]);

  if (!isConnectionDialogOpen) return null;

  const handleDriverChange = (d: 'sqlite' | 'postgres' | 'mysql') => {
    setDriver(d);
    if (d === 'mysql') {
      setPort(3306);
      if (username === 'postgres') setUsername('root');
      if (databaseName === 'postgres') setDatabaseName('');
    } else if (d === 'postgres') {
      setPort(5432);
      if (username === 'root') setUsername('postgres');
      if (!databaseName) setDatabaseName('postgres');
    }
  };

  const handleTest = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      const res = await ConnectionService.TestConnection({
        id: editingConnectionId || '',
        name: name || 'Test Conn',
        driver,
        colorTag,
        isReadOnly: false,
        txMode: 'auto',
        host,
        port: Number(port),
        username,
        password,
        databaseName,
        filePath,
        sslMode: 'disable',
        sslCaPath: '',
        sslCertPath: '',
        sslKeyPath: '',
        sshEnabled: false,
        sshHost: '',
        sshPort: 22,
        sshUser: '',
        sshAuthType: 'key',
        sshKeyPath: '',
        sshPassword: '',
        optionsJson: '{}',
        sortOrder: 0,
      } as any);
      setTestResult({ success: true, message: res });
    } catch (e: any) {
      setTestResult({ success: false, message: e?.message || String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const existing = editingConnectionId
        ? connections.find((c) => c.id === editingConnectionId)
        : null;
      const sortOrder = existing?.sortOrder ?? connections.length;

      const id = await ConnectionService.SaveConnection({
        id: editingConnectionId || '',
        folderId: folderId || null,
        name: name || `${driver.toUpperCase()} Connection`,
        driver,
        envType,
        colorTag:
          envType === 'dev' ? '#10b981' : envType === 'prod' ? '#ef4444' : '',
        isReadOnly: false,
        txMode: 'auto',
        host,
        port: Number(port),
        username,
        password,
        databaseName,
        filePath,
        sslMode: 'disable',
        sslCaPath: '',
        sslCertPath: '',
        sslKeyPath: '',
        sshEnabled: false,
        sshHost: '',
        sshPort: 22,
        sshUser: '',
        sshAuthType: 'key',
        sshKeyPath: '',
        sshPassword: '',
        optionsJson: '{}',
        sortOrder,
      } as any);

      const updated = await ConnectionService.ListConnections();
      setConnections(updated as any);
      moveConnectionToFolder(id, folderId || null);
      setPendingFolderIdForNewConn(null);
      setActiveConnection(id, databaseName || 'main', 'main');
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
          setActiveConnection(updated[0].id, updated[0].databaseName || 'main', 'main');
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
        className={`flex w-[560px] flex-col rounded-lg bg-[#191a20] border shadow-2xl text-xs text-zinc-300 overflow-hidden transition-colors ${
          envType === 'dev'
            ? 'border-emerald-700/60'
            : envType === 'prod'
            ? 'border-rose-700/60'
            : 'border-[#272932]'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`flex h-11 items-center justify-between border-b px-4 transition-colors ${
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
          </div>
          <button
            onClick={() => setConnectionDialogOpen(false)}
            className="rounded p-1 text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4">
          {/* Driver Selector */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1 font-semibold">
              Driver
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['sqlite', 'postgres', 'mysql'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDriverChange(d)}
                  className={`flex items-center justify-center gap-2 rounded border py-2 text-center uppercase font-mono tracking-wider cursor-pointer transition-colors ${
                    driver === d
                      ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                      : 'border-[#272932] bg-[#14151a] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <DbDriverIcon driver={d} className="h-4 w-4 shrink-0" />
                  <span>{d}</span>
                </button>
              ))}
            </div>
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

          {/* Connection Name & Folder / Group */}
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
              <input
                type="text"
                placeholder="/path/to/database.db"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] text-zinc-400 mb-1">Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">User</label>
                  <input
                    type="text"
                    value={username}
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

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Database Name {driver === 'mysql' && (
                    <span className="text-zinc-500 text-[10px] lowercase">(leave empty to show all databases)</span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder={driver === 'mysql' ? 'Optional (leave empty to list all databases)' : 'e.g. postgres'}
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                  className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Test Status Banner */}
          {testResult && (
            <div
              className={`flex items-center gap-2 p-2.5 rounded border text-[11px] ${
                testResult.success
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span className="truncate">{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex h-12 items-center justify-between border-t border-[#272932] px-4 bg-[#14151a]">
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
    </div>
  );
};

