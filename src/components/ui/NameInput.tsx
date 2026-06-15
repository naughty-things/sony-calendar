'use client';

import { useId, useMemo } from 'react';

/* Free-text input with autocomplete from a list of previous names.
   Uses the native <datalist> so the browser shows a dropdown of
   matches as the user types, but they can still enter any new name.
   The 'name' prop also flows to the parent via the standard input. */
export function NameInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  id
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const listId = id ? `${id}-list` : `${autoId}-list`;

  // De-dupe and sort suggestions; current value always present if set
  const opts = useMemo(() => {
    const set = new Set<string>();
    if (value) set.add(value);
    for (const s of suggestions) if (s && s.trim()) set.add(s.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [value, suggestions]);

  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={className}
        id={id}
      />
      <datalist id={listId}>
        {opts.map(o => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
