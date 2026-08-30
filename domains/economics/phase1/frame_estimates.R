# Phase-1 E2E estimate-framing step (R).
# Reads the FRESH panel-FE result (reghdfe coef/se/df/N) and the FRESH multiple-testing raw p-values,
# and frames the estimates artifact fields using the actual R runtime (stats::qt for the t CI; p from
# the multiple-testing runner). This is an execution step, NOT a JS adapter reimplementation.
suppressPackageStartupMessages(library(jsonlite))
args <- commandArgs(trailingOnly = FALSE)
fa <- args[grep("^--file=", args)]; here <- dirname(sub("^--file=", "", fa[1]))
args2 <- commandArgs(trailingOnly = TRUE)
resolve <- function(key, def){ i <- match(key, args2); if (!is.na(i) && i+1 <= length(args2)) args2[i+1] else def }
PANEL <- resolve("--panel", "role-team-out/phase1_run/panel_fe.json")
MT <- resolve("--mt", "role-team-out/phase1_run/multcomp.json")
OUT <- resolve("--out", "role-team-out/phase1_run/estimates.json")

panel <- fromJSON(PANEL, simplifyVector = FALSE)
mt <- fromJSON(MT, simplifyVector = FALSE)
coefs <- panel$coefficients; ses <- panel$std_errors
df_r <- as.numeric(panel$inference_configuration$stata_dof_evidence$df_r)
n <- as.integer(panel$n)
terms <- c("value", "capital")
tcrit <- qt(0.975, df = df_r)
est_rows <- lapply(terms, function(t) {
  eid <- paste0("EST_GRUNFELD_", toupper(t))
  est <- coefs[[t]]; se <- ses[[t]]
  list(estimate_id = eid, term = t, estimate = est, std_error = se,
       ci_lower = est - tcrit*se, ci_upper = est + tcrit*se,
       p_value = mt$estimates$raw_p[[eid]], n = n,
       multiple_testing_family_ids = c("FAM_GRUNFELD_MHT_HOLM","FAM_GRUNFELD_MHT_BH"))
})
names(est_rows) <- c("EST_GRUNFELD_VALUE","EST_GRUNFELD_CAPITAL")
out <- list(implementation_id = "panel.fe.stata.reghdfe", benchmark_id = "phase1_grunfeld_e2e_v1",
            dataset_checksum = panel$dataset_checksum, n = n, residual_df = df_r,
            frames = est_rows)
dir.create(dirname(OUT), showWarnings = FALSE, recursive = TRUE)
write_json(out, OUT, pretty = TRUE, auto_unbox = TRUE, digits = 16)
cat(toJSON(out, pretty = TRUE, auto_unbox = TRUE, digits = 16))
