param(
  [string]$DocxPath,
  [string]$PdfPath
)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($DocxPath, $false, $true)
  $doc.ExportAsFixedFormat($PdfPath, 17)
  $pages = $doc.ComputeStatistics(2)  # wdStatisticPages
  Write-Output ("PAGES " + $pages)
  $doc.Close($false)
} finally {
  $word.Quit()
}
