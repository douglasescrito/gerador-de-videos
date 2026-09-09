export async function executar(contexto) {
  const {
    path,
    setArchiveReview,
    required,
    options,
  } = contexto;
  {
    const tags = (options.tags ?? []).flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean);
    console.log(JSON.stringify(setArchiveReview({
      dbFile: path.resolve(required(options.db, "--db")),
      receiptPath: options.receipt ? path.resolve(String(options.receipt)) : null,
      receiptId: options["receipt-id"] ?? null,
      status: required(options.status, "--status"),
      rating: options.rating == null ? null : Number(options.rating),
      tags,
      notes: options.notes ?? null,
    }), null, 2));
  }
}
