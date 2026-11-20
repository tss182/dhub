import React, { useState, useEffect } from 'react';
import { WorkspaceService } from '../../bindings/dhub/internal/services';

export function usePanelResizers() {
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_left_sidebar_w');
    return saved ? Math.max(180, Math.min(600, Number(saved))) : 256;
  });
  const [isDraggingLeftResizer, setIsDraggingLeftResizer] = useState(false);

  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_right_sidebar_w');
    return saved ? Math.max(180, Math.min(1000, Number(saved))) : 280;
  });
  const [isDraggingRightResizer, setIsDraggingRightResizer] = useState(false);

  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => {
    const saved = localStorage.getItem('dhub_bottom_panel_h');
    return saved ? Math.max(120, Math.min(800, Number(saved))) : 280;
  });
  const [isDraggingBottomResizer, setIsDraggingBottomResizer] = useState(false);

  useEffect(() => {
    WorkspaceService.GetSettings()
      .then((settings) => {
        if (!settings) return;
        if (settings['dhub_left_sidebar_w']) {
          const w = Math.max(180, Math.min(600, Number(settings['dhub_left_sidebar_w'])));
          if (!Number.isNaN(w)) setLeftSidebarWidth(w);
        }
        if (settings['dhub_right_sidebar_w']) {
          const w = Math.max(180, Math.min(1000, Number(settings['dhub_right_sidebar_w'])));
          if (!Number.isNaN(w)) setRightSidebarWidth(w);
        }
        if (settings['dhub_bottom_panel_h']) {
          const h = Math.max(120, Math.min(800, Number(settings['dhub_bottom_panel_h'])));
          if (!Number.isNaN(h)) setBottomPanelHeight(h);
        }
      })
      .catch(() => {});
  }, []);

  const handleLeftResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeftResizer(true);
    const startX = e.clientX;
    const startWidth = leftSidebarWidth;
    let latestWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const maxW = Math.max(220, Math.min(650, window.innerWidth - 360));
      const newWidth = Math.max(180, Math.min(maxW, startWidth + deltaX));
      latestWidth = newWidth;
      setLeftSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingLeftResizer(false);
      localStorage.setItem('dhub_left_sidebar_w', String(latestWidth));
      WorkspaceService.SaveSetting('dhub_left_sidebar_w', String(latestWidth)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleRightResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRightResizer(true);
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;
    let latestWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const maxW = Math.max(260, Math.min(1000, window.innerWidth - 200));
      const newWidth = Math.max(180, Math.min(maxW, startWidth + deltaX));
      latestWidth = newWidth;
      setRightSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingRightResizer(false);
      localStorage.setItem('dhub_right_sidebar_w', String(latestWidth));
      WorkspaceService.SaveSetting('dhub_right_sidebar_w', String(latestWidth)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleBottomResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingBottomResizer(true);
    const startY = e.clientY;
    const startHeight = bottomPanelHeight;
    let latestHeight = startHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const maxH = Math.max(180, window.innerHeight - 160);
      const newHeight = Math.max(100, Math.min(maxH, startHeight + deltaY));
      latestHeight = newHeight;
      setBottomPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingBottomResizer(false);
      localStorage.setItem('dhub_bottom_panel_h', String(latestHeight));
      WorkspaceService.SaveSetting('dhub_bottom_panel_h', String(latestHeight)).catch(() => {});
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return {
    leftSidebarWidth,
    setLeftSidebarWidth,
    isDraggingLeftResizer,
    handleLeftResizerMouseDown,
    rightSidebarWidth,
    setRightSidebarWidth,
    isDraggingRightResizer,
    handleRightResizerMouseDown,
    bottomPanelHeight,
    setBottomPanelHeight,
    isDraggingBottomResizer,
    handleBottomResizerMouseDown,
  };
}
