import React, { useState } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { ConnectionService } from '../../../bindings/dhub/internal/services';
import { X, CheckCircle, AlertCircle, Database } from 'lucide-react';

export const ConnectionDialog: React.FC = () => {
  const { isConnectionDialogOpen, setConnectionDialogOpen } = useWorkbenchStore();
  const { connections, setConnections, setActiveConnection } = useConnectionStore();

  const [driver, setDriver] = useState<'sqlite' | 'postgres' | 'mysql'>('sqlite');
  const [name, setName] = useState('');
  const [filePath, setFilePath] = useState('/home/tss/.gemini/antigravity/dhub_demo.db');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5432);
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [databaseName, setDatabaseName] = useState('postgres');
  const [colorTag, setColorTag] = useState('#3b82f6');

  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isConnectionDialogOpen) return null;

  const handleTest = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      const res = await ConnectionService.TestConnection({
        id: '',
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
      const id = await ConnectionService.SaveConnection({
        id: '',
        name: name || `${driver.toUpperCase()} Connection`,
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

      const updated = await ConnectionService.ListConnections();
      setConnections(updated as any);
      setActiveConnection(id, databaseName, 'main');
      setConnectionDialogOpen(false);
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="flex w-[560px] flex-col rounded-lg bg-[#191a20] border border-[#272932] shadow-2xl text-xs text-zinc-300">
        {/* Modal Header */}
        <div className="flex h-11 items-center justify-between border-b border-[#272932] px-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-sm text-zinc-100">Data Sources & Drivers</span>
          </div>
          <button
            onClick={() => setConnectionDialogOpen(false)}
            className="rounded p-1 text-zinc-400 hover:text-white hover:bg-[#22242c]"
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
                  onClick={() => {
                    setDriver(d);
                    if (d === 'mysql') setPort(3306);
                    if (d === 'postgres') setPort(5432);
                  }}
                  className={`rounded border py-2 text-center uppercase font-mono tracking-wider cursor-pointer transition-colors ${
                    driver === d
                      ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                      : 'border-[#272932] bg-[#14151a] text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Name */}
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Display Name</label>
            <input
              type="text"
              placeholder={`e.g. Local ${driver.toUpperCase()}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded bg-[#121317] border border-[#272932] px-3 py-1.5 text-zinc-200 focus:border-blue-500 focus:outline-none"
            />
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
                <label className="block text-[11px] text-zinc-400 mb-1">Database Name</label>
                <input
                  type="text"
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
          <button
            type="button"
            onClick={handleTest}
            disabled={isLoading}
            className="rounded border border-[#272932] hover:bg-[#22242c] px-3 py-1.5 text-zinc-300 font-medium transition-colors cursor-pointer"
          >
            {isLoading ? 'Testing...' : 'Test Connection'}
          </button>

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
              Save & Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

