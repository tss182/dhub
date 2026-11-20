package services

import (
	"archive/zip"
	"bufio"
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
)

type xlsxStreamWriter struct {
	zw          *zip.Writer
	sheetWriter io.Writer
	bw          *bufio.Writer
	rowIndex    int
}

func newXLSXStreamWriter(dst io.Writer) (*xlsxStreamWriter, error) {
	zw := zip.NewWriter(dst)

	writeStatic := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = io.WriteString(w, content)
		return err
	}

	if err := writeStatic("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if err := writeStatic("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if err := writeStatic("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Export" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`); err != nil {
		_ = zw.Close()
		return nil, err
	}

	if err := writeStatic("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`); err != nil {
		_ = zw.Close()
		return nil, err
	}

	sw, err := zw.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		_ = zw.Close()
		return nil, err
	}
	bw := bufio.NewWriterSize(sw, 32*1024)
	if _, err := bw.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`); err != nil {
		_ = zw.Close()
		return nil, err
	}

	return &xlsxStreamWriter{
		zw:          zw,
		sheetWriter: sw,
		bw:          bw,
		rowIndex:    0,
	}, nil
}

func xlsxColRef(colIdx int) string {
	var b []byte
	n := colIdx + 1
	for n > 0 {
		rem := (n - 1) % 26
		b = append([]byte{byte('A' + rem)}, b...)
		n = (n - 1) / 26
	}
	return string(b)
}

func (x *xlsxStreamWriter) writeRow(values []any) error {
	x.rowIndex++
	if _, err := fmt.Fprintf(x.bw, `<row r="%d">`, x.rowIndex); err != nil {
		return err
	}
	var escBuf strings.Builder
	for cIdx, v := range values {
		if v == nil {
			continue
		}
		ref := xlsxColRef(cIdx) + strconv.Itoa(x.rowIndex)
		switch val := v.(type) {
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
			if _, err := fmt.Fprintf(x.bw, `<c r="%s" t="n"><v>%v</v></c>`, ref, val); err != nil {
				return err
			}
		case bool:
			bVal := "0"
			if val {
				bVal = "1"
			}
			if _, err := fmt.Fprintf(x.bw, `<c r="%s" t="b"><v>%s</v></c>`, ref, bVal); err != nil {
				return err
			}
		default:
			s := fmt.Sprintf("%v", val)
			escBuf.Reset()
			_ = xml.EscapeText(&escBuf, []byte(s))
			if _, err := fmt.Fprintf(x.bw, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, escBuf.String()); err != nil {
				return err
			}
		}
	}
	_, err := x.bw.WriteString(`</row>`)
	return err
}

func (x *xlsxStreamWriter) Close() error {
	if _, err := x.bw.WriteString(`</sheetData></worksheet>`); err != nil {
		_ = x.zw.Close()
		return err
	}
	if err := x.bw.Flush(); err != nil {
		_ = x.zw.Close()
		return err
	}
	return x.zw.Close()
}
