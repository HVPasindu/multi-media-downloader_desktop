import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

/**
 * Reusable Pagination Control Component
 *
 * @param {object} props
 * @param {number} props.currentPage - Active 1-indexed page
 * @param {number} props.pageSize - Current page size (10, 20, 50)
 * @param {number} props.totalRecords - Total number of matching records in database
 * @param {(page: number) => void} props.onPageChange - Page change callback
 * @param {(size: number) => void} props.onPageSizeChange - Page size change callback
 * @param {Array<number>} [props.pageSizeOptions=[10, 20, 50]] - Available rows per page options
 * @param {string} [props.recordLabel='downloads'] - Descriptive label for records
 */
export default function Pagination({
  currentPage = 1,
  pageSize = 20,
  totalRecords = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  recordLabel = 'downloads'
}) {
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))
  const safePage = Math.min(Math.max(1, currentPage), totalPages)

  const startRecord = totalRecords === 0 ? 0 : (safePage - 1) * pageSize + 1
  const endRecord = Math.min(safePage * pageSize, totalRecords)

  // Generate page numbers with ellipsis for large page counts
  const getPageNumbers = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const pages = []
    if (safePage <= 3) {
      pages.push(1, 2, 3, '...', totalPages)
    } else if (safePage >= totalPages - 2) {
      pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
    } else {
      pages.push(1, '...', safePage, '...', totalPages)
    }
    return pages
  }

  const handlePageClick = (page) => {
    if (page === '...' || page === safePage) return
    if (typeof onPageChange === 'function') {
      onPageChange(page)
    }
  }

  const handleSizeChange = (e) => {
    const newSize = Number(e.target.value)
    if (typeof onPageSizeChange === 'function') {
      onPageSizeChange(newSize)
    }
  }

  const isFirstDisabled = safePage <= 1
  const isLastDisabled = safePage >= totalPages

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 bg-[#040B1C]/80 border-t border-primary/15 text-xs text-text-muted select-none">
      {/* Left: Summary text */}
      <div className="flex items-center gap-2">
        <span className="font-medium">
          {totalRecords === 0
            ? `Showing 0 ${recordLabel}`
            : `Showing ${startRecord}–${endRecord} of ${totalRecords} ${recordLabel}`}
        </span>
      </div>

      {/* Middle/Right: Rows per page and page navigation */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Rows per page selector */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-muted/80">Rows per page:</span>
          <select
            value={pageSize}
            onChange={handleSizeChange}
            className="bg-[#07152E] border border-primary/20 rounded-lg px-2.5 py-1 text-xs font-semibold text-white focus:outline-none focus:border-primary cursor-pointer"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt} className="bg-[#07152E] text-white">
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            type="button"
            onClick={() => handlePageClick(1)}
            disabled={isFirstDisabled}
            className={`p-1.5 rounded-lg border transition-all ${
              isFirstDisabled
                ? 'border-primary/10 text-text-muted/30 cursor-not-allowed bg-transparent'
                : 'border-primary/20 text-text-muted hover:text-white hover:bg-[#0B1C38] cursor-pointer'
            }`}
            title="First page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>

          {/* Previous page */}
          <button
            type="button"
            onClick={() => handlePageClick(safePage - 1)}
            disabled={isFirstDisabled}
            className={`p-1.5 rounded-lg border transition-all ${
              isFirstDisabled
                ? 'border-primary/10 text-text-muted/30 cursor-not-allowed bg-transparent'
                : 'border-primary/20 text-text-muted hover:text-white hover:bg-[#0B1C38] cursor-pointer'
            }`}
            title="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Page numbers */}
          {getPageNumbers().map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`ellipsis-${idx}`} className="px-1 text-text-muted/50 font-mono">
                  …
                </span>
              )
            }

            const isActive = p === safePage
            return (
              <button
                key={p}
                type="button"
                onClick={() => handlePageClick(p)}
                className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-[#514BFF] text-white border border-[#19D8FF]/40 shadow-sm'
                    : 'border border-primary/20 text-text-muted hover:text-white hover:bg-[#0B1C38] cursor-pointer'
                }`}
              >
                {p}
              </button>
            )
          })}

          {/* Next page */}
          <button
            type="button"
            onClick={() => handlePageClick(safePage + 1)}
            disabled={isLastDisabled}
            className={`p-1.5 rounded-lg border transition-all ${
              isLastDisabled
                ? 'border-primary/10 text-text-muted/30 cursor-not-allowed bg-transparent'
                : 'border-primary/20 text-text-muted hover:text-white hover:bg-[#0B1C38] cursor-pointer'
            }`}
            title="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Last page */}
          <button
            type="button"
            onClick={() => handlePageClick(totalPages)}
            disabled={isLastDisabled}
            className={`p-1.5 rounded-lg border transition-all ${
              isLastDisabled
                ? 'border-primary/10 text-text-muted/30 cursor-not-allowed bg-transparent'
                : 'border-primary/20 text-text-muted hover:text-white hover:bg-[#0B1C38] cursor-pointer'
            }`}
            title="Last page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
