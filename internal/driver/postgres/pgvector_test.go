package postgres

import (
	"testing"
)

func TestApplyPgVectorCapabilities(t *testing.T) {
	tests := []struct {
		ver       string
		hnsw      bool
		parallel  bool
		halfvec   bool
		sparsevec bool
		bit       bool
		l1        bool
		iterative bool
	}{
		{"0.4.4", false, false, false, false, false, false, false},
		{"0.5.1", true, false, false, false, false, false, false},
		{"0.6.2", true, true, false, false, false, false, false},
		{"0.7.4", true, true, true, true, true, true, false},
		{"0.8.0", true, true, true, true, true, true, true},
	}

	for _, tc := range tests {
		t.Run(tc.ver, func(t *testing.T) {
			st := &PgVectorStatus{Installed: true, InstalledVersion: tc.ver}
			applyPgVectorCapabilities(st)
			if st.SupportsHNSW != tc.hnsw ||
				st.SupportsParallelHNSW != tc.parallel ||
				st.SupportsHalfvec != tc.halfvec ||
				st.SupportsSparsevec != tc.sparsevec ||
				st.SupportsBit != tc.bit ||
				st.SupportsL1 != tc.l1 ||
				st.SupportsIterative != tc.iterative {
				t.Fatalf("unexpected capabilities for %s: %+v", tc.ver, st)
			}
		})
	}
}

func TestParsePgVectorIndexDef(t *testing.T) {
	t.Run("HNSW cosine with params", func(t *testing.T) {
		def := `CREATE INDEX idx_docs_emb_hnsw ON public.docs USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')`
		info := parsePgVectorIndexDef("idx_docs_emb_hnsw", "hnsw", def, true, "42 MB", 120)
		if info.Method != "hnsw" || info.Opclass != "vector_cosine_ops" || info.ColumnOrExpr != "embedding" {
			t.Fatalf("unexpected parsed index: %+v", info)
		}
		if info.WithParams["m"] != "16" || info.WithParams["ef_construction"] != "64" {
			t.Fatalf("unexpected WITH params: %+v", info.WithParams)
		}
		if info.IsExpressionQuantized {
			t.Errorf("expected IsExpressionQuantized=false")
		}
	})

	t.Run("Binary quantize partial expression index", func(t *testing.T) {
		def := `CREATE INDEX idx_docs_bq ON public.docs USING hnsw ((binary_quantize(embedding)::bit(1536)) bit_hamming_ops) WITH (m='24') WHERE (active = true)`
		info := parsePgVectorIndexDef("idx_docs_bq", "hnsw", def, true, "4 MB", 8)
		if info.Opclass != "bit_hamming_ops" {
			t.Errorf("Opclass = %q, want bit_hamming_ops", info.Opclass)
		}
		if !info.IsExpressionQuantized {
			t.Errorf("expected IsExpressionQuantized=true")
		}
		if info.WherePredicate != "(active = true)" {
			t.Errorf("WherePredicate = %q, want (active = true)", info.WherePredicate)
		}
		if info.WithParams["m"] != "24" {
			t.Errorf("WithParams[m] = %q, want 24", info.WithParams["m"])
		}
	})

	t.Run("IVFFlat halfvec", func(t *testing.T) {
		def := `CREATE INDEX idx_docs_half_ivf ON public.docs USING ivfflat (half_emb halfvec_l2_ops) WITH (lists='100')`
		info := parsePgVectorIndexDef("idx_docs_half_ivf", "ivfflat", def, true, "12 MB", 0)
		if info.Method != "ivfflat" || info.Opclass != "halfvec_l2_ops" || info.WithParams["lists"] != "100" {
			t.Fatalf("unexpected ivfflat parsed info: %+v", info)
		}
	})
}

func TestIsAllowedPgVectorGUC(t *testing.T) {
	allowed := []string{"hnsw.ef_search", "hnsw.iterative_scan", "ivfflat.probes", "enable_indexscan", "enable_seqscan"}
	for _, g := range allowed {
		if !IsAllowedPgVectorGUC(g) {
			t.Errorf("expected %q to be allowed", g)
		}
	}
	disallowed := []string{"search_path", "work_mem", "shared_preload_libraries", "hnsw.ef_search; DROP TABLE x"}
	for _, g := range disallowed {
		if IsAllowedPgVectorGUC(g) {
			t.Errorf("expected %q to be rejected", g)
		}
	}
}

