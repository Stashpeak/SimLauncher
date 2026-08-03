import { test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorPickerPopover } from '../../src/renderer/src/components/ColorPickerPopover';

test('Clicking HEX text focuses the color input', async () => {
    let changedColor = '';
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);

    render(
        <ColorPickerPopover
            color="#FF0000"
            onChange={(c) => changedColor = c}
            onClose={() => {}}
            anchorRef={{ current: anchor }}
        />
    );

    // Find the label text
    const labelText = screen.getByText('HEX');
    expect(labelText).toBeInTheDocument();

    // Find the input
    const input = screen.getByLabelText('Hex color value');
    expect(input).toBeInTheDocument();

    // Check it's not focused initially
    expect(input).not.toHaveFocus();

    // Click the label text
    fireEvent.click(labelText);

    // Should be focused now
    expect(input).toHaveFocus();
});
