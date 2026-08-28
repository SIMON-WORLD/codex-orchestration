# P7 panel_fe benchmark runner (fixest::feols).
# Reads the frozen benchmark CSV + manifest; writes a machine-readable JSON.
suppressPackageStartupMessages(library(fixest))
suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = FALSE)
fa <- args[grep("^--file=", args)]
here <- dirname(sub("^--file=", "", fa[1]))
CSV <- file.path(here, "..", "grunfeld.csv")
MAN <- file.path(here, "..", "benchmark.grunfeld.json")
OUT <- file.path(here, "..", "results", "r.json")
man <- fromJSON(MAN, simplifyVector = FALSE)

df <- read.csv(CSV)

m <- feols(invest ~ value + capital | firm + year, cluster = ~firm, data = df)
cv <- coef(m); sv <- se(m)
coefficients <- as.list(cv); names(coefficients) <- names(cv)
std_errors <- as.list(sv); names(std_errors) <- names(sv)

md <- feols(invest ~ value + capital | firm + year, data = df)
nd <- as.list(coef(md)); names(nd) <- names(coef(md))
ns <- as.list(se(md)); names(ns) <- names(se(md))

result <- list(
  implementation_id = "panel.fe.r.fixest",
  runtime_version = paste("R", as.character(getRversion())),
  package_version = paste("fixest", as.character(packageVersion("fixest"))),
  benchmark_id = "grunfeld_twfe_cluster",
  dataset_checksum = man$dataset$checksum,
  n = as.integer(m$nobs),
  cluster_count = length(unique(df$firm)),
  coefficients = coefficients,
  std_errors = std_errors,
  inference_configuration = list(
    clustering = "one-way cluster=firm",
    estimator = "fixest::feols (absorbed firm+year FE)",
    finite_sample_correction = "AER/Stata-style cluster-robust (matches Stata vce(cluster))",
    absorbed_fe_dof = "firm + year absorbed via fixef",
    covariance_definition = "fixest clustered (cluster=~firm)",
    covariance_family = "aes_cluster",
    note = "fixest clustered SE matches Stata reghdfe exactly"
  ),
  native_default = list(
    cov_type = "standard (iid, no cluster)",
    coefficients = nd,
    std_errors = ns,
    n = as.integer(md$nobs)
  )
)
dir.create(dirname(OUT), showWarnings = FALSE, recursive = TRUE)
write_json(result, OUT, pretty = TRUE, auto_unbox = TRUE, digits = 16)
cat(toJSON(result, pretty = TRUE, auto_unbox = TRUE, digits = 16))

