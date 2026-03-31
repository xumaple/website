import { render, screen } from '@testing-library/react';
import App from './App';

test('App module exports a component', () => {
  expect(typeof App).toBe('function');
});
