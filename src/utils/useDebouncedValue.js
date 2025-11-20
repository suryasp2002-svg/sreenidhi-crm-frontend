import { useEffect, useState } from 'react';

export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), Math.max(0, delay));
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}
