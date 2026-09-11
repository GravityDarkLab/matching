import { useSearchParams } from 'react-router-dom'

export function usePagedFilter(filterParamName: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const filterValue = searchParams.get(filterParamName) ?? ''
  const parsedPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1

  function setFilter(value: string) {
    setSearchParams(value ? { [filterParamName]: value } : {})
  }
  function setPage(p: number) {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev)
      n.set('page', String(p))
      return n
    })
  }

  return { page, filterValue, setFilter, setPage }
}
