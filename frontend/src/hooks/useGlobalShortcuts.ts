import { useEffect, useRef } from 'react';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { useSettingsStore } from '../stores/useSettingsStore';

interface UseGlobalShortcutsOptions {
  onOpenSearchEverywhere: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onCancelQuery: (tabId: string) => void;
}

export function useGlobalShortcuts({
  onOpenSearchEverywhere,
  onToggleLeftPanel,
  onToggleRightPanel,
  onCancelQuery,
}: UseGlobalShortcutsOptions) {
  const callbacksRef = useRef({
    onOpenSearchEverywhere,
    onToggleLeftPanel,
    onToggleRightPanel,
    onCancelQuery,
  });
  callbacksRef.current = {
    onOpenSearchEverywhere,
    onToggleLeftPanel,
    onToggleRightPanel,
    onCancelQuery,
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        callbacksRef.current.onOpenSearchEverywhere();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        callbacksRef.current.onToggleLeftPanel();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        callbacksRef.current.onToggleRightPanel();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        const activeId = useWorkbenchStore.getState().activeTabId;
        if (activeId) {
          useWorkbenchStore.getState().closeTab(activeId);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const activeId = useWorkbenchStore.getState().activeTabId;
        if (activeId) {
          callbacksRef.current.onCancelQuery(activeId);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        useWorkbenchStore.getState().toggleHelpModal();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        const store = useWorkbenchStore.getState();
        if (!store.isRightPanelOpen) {
          store.setRightPanelOpen(true);
          store.setActiveRightSidebarTab('views');
        } else if (store.activeRightSidebarTab === 'views') {
          store.setRightPanelOpen(false);
        } else {
          store.setActiveRightSidebarTab('views');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
