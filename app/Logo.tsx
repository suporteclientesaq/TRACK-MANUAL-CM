/**
 * Marca do painel. O caminho do SVG fica em LOGO_PATH: para trocar pelo logo
 * definitivo, cole aqui o "d" do path (o viewBox é 0 0 24 24; ajuste se o seu
 * logo usar outro).
 */
export const LOGO_PATH =
  "M12 1.5 21.5 7v10L12 22.5 2.5 17V7L12 1.5Zm0 3.2L5.3 8.6v6.8l6.7 3.9 6.7-3.9V8.6L12 4.7Zm0 3.1 3.3 1.9v3.8L12 15.4l-3.3-1.9V9.7L12 7.8Z";

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
