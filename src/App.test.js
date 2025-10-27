import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login screen title', () => {
  render(<App />);
  const title = screen.getByText(/Sreenidhi CRM/i);
  expect(title).toBeInTheDocument();
});
