/** DROP brand tokens (docs/BRAND.md). */
export const colors = {
  navy: '#071B3A', navy2: '#0C2E65', orange: '#FF6B00', orangeSoft: '#FFF4EC', white: '#FFFFFF', grey: '#F5F7FA',
  line: '#D2DAE4', text: '#14223A', muted: '#4D5B71', success: '#17744A', successSoft: '#E7F6EE', danger: '#B42318', dangerSoft: '#FDECEC', blue: '#1A73E8',
};
export const radius = { sm: 10, md: 14, lg: 20 };
export const space = (n: number) => n * 4;
export const type = {
  h1: { fontSize: 28, fontWeight: '800' as const, color: colors.navy, letterSpacing: -0.6 },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.navy },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.navy },
};
