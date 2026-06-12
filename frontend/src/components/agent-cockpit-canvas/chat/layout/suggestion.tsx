import { Card, CardContent } from "@/components/agent-cockpit-canvas/ui/card";
import { cn } from "@/lib/agent-cockpit-canvas/utils";
import type { KaypalSuggestion } from "@/components/agent-cockpit-canvas/chat/kaypal-chat-runtime";

export const Suggestions = (props: {
  suggestions: KaypalSuggestion[];
  onSuggestionClick: (message: string) => void;
  isLoading?: boolean;
}) => {
  const { isLoading } = props;
  if (isLoading) return null;

  return (
    <div className="suggestions flex flex-col">
      <div className="flex gap-2">
        {props.suggestions.map((suggestion, index) => (
          <Card
            className={cn(
              "rounded-lg bg-card text-card-foreground border border-border px-3 py-2 shadow-sm",
              "hover:cursor-pointer hover:bg-accent/10 hover:border-accent/40",
              "transition-all duration-200",
            )}
            key={index}
            onClick={() => props.onSuggestionClick(suggestion.message)}
          >
            <CardContent className="px-0 py-0 text-sm font-medium">
              {" "}
              {suggestion.title}{" "}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
