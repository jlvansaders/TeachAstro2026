// Shared htm binding.
// Imports React via the importmap bare specifier so every app that uses this
// file shares the same React instance as react-dom — avoiding the two-instance
// Symbol mismatch that causes React error #31.

import { createElement } from 'react';
import htm from 'htm';

export const html = htm.bind(createElement);
