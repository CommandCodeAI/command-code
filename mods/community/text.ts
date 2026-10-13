export function hasControlCharacters(text: string): boolean {
	return [...text].some(
		character =>
			character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
	);
}
