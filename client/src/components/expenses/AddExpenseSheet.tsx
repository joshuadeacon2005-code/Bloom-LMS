import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Paperclip, Loader2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateLine,
  useUpdateLine,
  useUploadReceipt,
  useNetSuiteCategories,
  useNetSuiteCurrencies,
  type ExpenseLine,
} from '@/hooks/useExpenses'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the sheet edits this existing line; otherwise creates a new one. */
  editing?: ExpenseLine | null
}

export function AddExpenseSheet({ open, onOpenChange, editing }: Props) {
  const isEdit = !!editing

  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('HKD')
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [description, setDescription] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const categories = useNetSuiteCategories()
  const currencies = useNetSuiteCurrencies()
  const createLine = useCreateLine()
  const updateLine = useUpdateLine()
  const uploadReceipt = useUploadReceipt()

  // Reset / hydrate form when the sheet opens
  useEffect(() => {
    if (!open) return
    if (editing) {
      setCategory(editing.category ?? '')
      setAmount(editing.amount)
      setCurrency(editing.currency)
      setExpenseDate(editing.expenseDate)
      setDescription(editing.description ?? '')
    } else {
      setCategory('')
      setAmount('')
      setCurrency('HKD')
      setExpenseDate(format(new Date(), 'yyyy-MM-dd'))
      setDescription('')
    }
    setReceiptFile(null)
  }, [open, editing])

  const submitting = createLine.isPending || updateLine.isPending || uploadReceipt.isPending

  async function handleSubmit() {
    const numericAmount = parseFloat(amount)
    if (!category) return
    if (!numericAmount || numericAmount <= 0) return
    if (!currency) return
    if (!expenseDate) return

    try {
      const payload = {
        category,
        amount: numericAmount,
        currency,
        expenseDate,
        description: description.trim() || null,
      }

      const line = isEdit
        ? await updateLine.mutateAsync({ id: editing!.id, data: payload })
        : await createLine.mutateAsync(payload)

      if (receiptFile) {
        await uploadReceipt.mutateAsync({ lineId: line.id, file: receiptFile })
      }

      onOpenChange(false)
    } catch {
      // Toasts are handled in the hooks
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit expense' : 'Add expense'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Update this expense. It must not be in an approved or synced report.'
              : 'Add a single expense as a draft. You can bundle multiple drafts into a report later.'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            {categories.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading categories from NetSuite…
              </div>
            ) : categories.isError ? (
              <p className="text-sm text-destructive">Could not load categories from NetSuite.</p>
            ) : (
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.name ?? c.id}>
                      {c.name ?? `Category #${c.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              {currencies.isLoading ? (
                <Input disabled value="Loading…" />
              ) : (
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(currencies.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.symbol ?? c.id}>
                        {c.symbol ?? c.name ?? c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="e.g. Client dinner — Acme Corp"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="receipt">Receipt (optional)</Label>
            {editing?.receiptUrl && !receiptFile && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                <a href={editing.receiptUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {editing.receiptOriginalName ?? 'Current receipt'}
                </a>
              </div>
            )}
            <Input
              id="receipt"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            />
            {receiptFile && (
              <p className="text-xs text-muted-foreground">
                Selected: {receiptFile.name}
              </p>
            )}
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !category || !amount}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add expense'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
