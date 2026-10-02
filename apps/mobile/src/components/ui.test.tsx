import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from './ui';

/**
 * `render` is asynchronous in React Native Testing Library 14 — it awaits the
 * concurrent-root commit. Treating it as synchronous returns a pending promise
 * whose queries are undefined, so every test must await it.
 */
describe('Button', () => {
  it('renders its title', async () => {
    await render(<Button title="Click me" onPress={() => {}} />);
    expect(screen.getByText('Click me')).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Button title="Tap me" onPress={onPress} />);

    fireEvent.press(screen.getByText('Tap me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Disabled" onPress={onPress} disabled />);

    fireEvent.press(screen.getByText('Disabled'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress while loading', async () => {
    // Loading swaps the label for a spinner, so the press target is the
    // button's accessibility role rather than its text.
    const onPress = jest.fn();
    await render(<Button title="Saving" onPress={onPress} loading />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks itself busy for screen readers while loading', async () => {
    await render(<Button title="Saving" onPress={() => {}} loading />);
    // Asserted on the prop rather than a matcher, which differs across
    // React Native Testing Library versions.
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });
});
