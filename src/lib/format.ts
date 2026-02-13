export function formatDate(value: string | null) {
  if (!value) {
    return "Date inconnue";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatRating(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(1);
}
