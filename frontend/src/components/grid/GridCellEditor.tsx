import React from 'react';
import { ColumnMeta } from '../../types/domain';

interface GridCellEditorProps {
  colInputType: 'date' | 'datetime-local' | 'time' | 'text';
  column?: ColumnMeta;
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
  column,
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

  const enumValues = column?.enumValues?.filter(Boolean) || [];
  const rawType = (column?.rawType || column?.dataType || '').toLowerCase().trim();
  const isBoolean = rawType === 'bool' || rawType === 'boolean';

  if (enumValues.length > 0 || isBoolean) {
    const options = enumValues.length > 0 ? enumValues : ['true', 'false'];
    const normalizedVal = isBoolean
      ? editVal.toLowerCase() === 't' || editVal.toLowerCase() === 'true' || editVal === '1'
        ? 'true'
        : editVal.toLowerCase() === 'f' || editVal.toLowerCase() === 'false' || editVal === '0'
        ? 'false'
        : editVal
      : editVal;
    return (
      <select
        autoFocus
        value={normalizedVal}
        onChange={(e) => {
          onChange(e.target.value);
        }}
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
        className={`w-full border px-1 py-0.5 text-white outline-none rounded cursor-pointer ${variantClasses}`}
      >
        {column?.isNullable && <option value="">NULL</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={colInputType === 'text' ? 'text' : colInputType}
      step={colInputType === 'datetime-local' || colInputType === 'time' ? '1' : undefined}
      autoFocus
      ref={(el) => {
        if (el && isFirstEditRenderRef.current) {
          isFirstEditRenderRef.current = false;
          if (colInputType !== 'text') {
            try {
              el?.showPicker?.();
            } catch {}
          } else {
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
