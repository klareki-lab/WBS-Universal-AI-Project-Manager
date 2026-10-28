import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Explicit cleanup works with globals:false in all supported Vitest versions.
afterEach(cleanup);
