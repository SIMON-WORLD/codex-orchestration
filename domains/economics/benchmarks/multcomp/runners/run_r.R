# Real-data Grunfeld multiple-testing runner (R).
# Reads the accepted frozen panel-FE reghdfe result and computes raw p-values programmatically (stats::pt),
# then applies Holm (FWER) and Benjamini-Hochberg (FDR) via stats::p.adjust.
# No scientific values are hard-coded; the benchmark family is an ENGINEERING VERIFICATION family.
suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = FALSE)
fa <- args[grep("^--file=", args)]
here <- dirname(sub("^--file=", "", fa[1]))
args2 <- commandArgs(trailingOnly = TRUE)
resolve <- function(key, def){ i <- match(key, args2); if (!is.na(i) && i+1 <= length(args2)) args2[i+1] else def }

STATA <- resolve("--stata", file.path(here, "..", "..", "panel_fe", "results", "stata.json"))
PANEL_MAN <- resolve("--manifest", file.path(here, "..", "..", "panel_fe", "benchmark.grunfeld.json"))
OUT <- resolve("--out", file.path(here, "..", "results", "r.json"))

sta <- fromJSON(STATA, simplifyVector = FALSE)
man <- fromJSON(PANEL_MAN, simplifyVector = FALSE)
coefs <- sta$coefficients
ses <- sta$std_errors
df_r <- as.numeric(sta$inference_configuration$stata_dof_evidence$df_r)
n <- as.integer(sta$n)

terms <- c("value", "capital")
estimate_ids <- paste0("EST_GRUNFELD_", toupper(terms))
raw_p <- vapply(terms, function(t) {
  tv <- coefs[[t]] / ses[[t]]
  2 * pt(abs(tv), df = df_r, lower.tail = FALSE)
}, numeric(1))
names(raw_p) <- estimate_ids

pv <- as.numeric(raw_p[estimate_ids])
holm <- p.adjust(pv, method = "holm")
bh <- p.adjust(pv, method = "BH")
names(holm) <- estimate_ids
names(bh) <- estimate_ids

result <- list(
  implementation_id = "multcomp.r.base",
  runtime_version = paste("R", as.character(getRversion())),
  package_version = paste("base stats", as.character(packageVersion("stats"))),
  benchmark_id = "grunfeld_multcomp_v1",
  capability_id = "economics.stat.testing.multcomp",
  dataset_checksum = man$dataset$checksum,
  source = list(
    dataset = "grunfeld.csv",
    panel_fe_benchmark_id = "grunfeld_twfe_cluster",
    accepted_result = "domains/economics/benchmarks/panel_fe/results/stata.json",
    upstream_artifact_ids = c("MODEL_GRUNFELD", "ESTIMATES_GRUNFELD", "DIAGNOSTICS_GRUNFELD"),
    estimate_ids = estimate_ids,
    residual_df = df_r
  ),
  raw_p_value_provenance = "two-sided finite-df Student-t p from t = coef/se with df = reghdfe e(df_r); computed programmatically from accepted frozen reghdfe result; NOT hard-coded",
  n = n,
  family_definition = list(
    family_ids = c("FAM_GRUNFELD_MHT_HOLM", "FAM_GRUNFELD_MHT_BH"),
    note = "ENGINEERING VERIFICATION family: significance tests of the two Grunfeld panel-FE coefficients (value, capital). NOT a substantive research-family recommendation."
  ),
  estimates = list(order = estimate_ids, raw_p = as.list(raw_p), t_stat = as.list(vapply(terms, function(t) coefs[[t]] / ses[[t]], numeric(1)))),
  adjusted = list(holm = as.list(holm), benjamini_hochberg = as.list(bh)),
  methods = list(
    holm = list(tool = "stats::p.adjust", method = "holm", definition = "Holm (1979) family-wise error rate step-down"),
    benjamini_hochberg = list(tool = "stats::p.adjust", method = "BH", definition = "Benjamini & Hochberg (1995) false discovery rate")
  )
)
dir.create(dirname(OUT), showWarnings = FALSE, recursive = TRUE)
write_json(result, OUT, pretty = TRUE, auto_unbox = TRUE, digits = 16)
cat(toJSON(result, pretty = TRUE, auto_unbox = TRUE, digits = 16))
