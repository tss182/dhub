import React from 'react';

interface GridCellEditorProps {
  colInputType: 'date' | 'datetime-local' | 'time' | 'text';
  editVal: string;
  variant: 'update' | 'insert';
  isFirstEditRenderRef: React.MutableRefObject<boolean>;
  onChange: (val: string) => void;
  onFinishEdit: () => void;
  onCancelEdit: () => void;
  onTabNext: () => void;
}

export const GridCellEditor: React.FC<GridCellEditorProps> = ({
  colInputType,
  editVal,
  variant,
  isFirstEditRenderRef,
  onChange,
  onFinishEdit,
  onCancelEdit,
  onTabNext,
}) => {
  const variantClasses =
    variant === 'insert'
      ? 'bg-[#101115] border-emerald-500 font-mono text-xs shadow-inner'
      : 'bg-[#121317] border-blue-500';

  return (
    <input
      type={colInputType === 'text' ? 'text' : colInputType}
      step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
      autoFocus
      ref={(el) => {
        if (el) {
          if (colInputType !== 'text') {
            try {
              el?.showPicker?.();
            } catch {}
          } else if (isFirstEditRenderRef.current) {
            isFirstEditRenderRef.current = false;
            try {
              const len = el.value.length;
              el.setSelectionRange(len, len);
            } catch {}
          }
        }
      }}
      value={editVal}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onFinishEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFinishEdit();
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancelEdit();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          onTabNext();
        }
      }}
      className={`[color-scheme:dark] w-full border px-1 py-0.5 text-white outline-none rounded ${variantClasses} ${
        colInputType !== 'text' ? 'cursor-pointer' : ''
      }`}
    />
  );
};
