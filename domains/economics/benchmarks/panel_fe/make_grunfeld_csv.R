# Generator: freeze plm::Grunfeld into a canonical CSV for the panel_fe benchmark.
# Source: R package 'plm', dataset 'Grunfeld' (10 firms, 1935-1954).
suppressPackageStartupMessages(library(plm))
data("Grunfeld", package = "plm")
cat("original cols:", paste(names(Grunfeld), collapse=","), "\n")
df <- Grunfeld
# Rename inv -> invest for a clear outcome name; keep firm/year/value/capital.
df$invest <- df$inv
out <- data.frame(firm=as.integer(df$firm), year=as.integer(df$year),
                  invest=as.numeric(df$invest), value=as.numeric(df$value),
                  capital=as.numeric(df$capital))
write.csv(out, "domains/economics/benchmarks/panel_fe/grunfeld.csv",
          row.names=FALSE, quote=FALSE)
cat("rows", nrow(out), "firms", length(unique(out$firm)),
    "years", min(out$year), max(out$year), "\n")
